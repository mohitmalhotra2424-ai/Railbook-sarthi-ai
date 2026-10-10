import { describe, expect, it, vi } from "vitest";
import {
  LlmMalformedResponseError,
  LlmProviderError,
  LlmTimeoutError,
  OpenAiCompatibleClient,
  type ChatMessage,
} from "@/assistant/llm/client";
import { describeLlmConfigs, readLlmConfigs } from "@/assistant/llm/config";

const SECRET_KEY = "nvapi-test-secret-value-abcdef123456";

function cfg(overrides: Partial<Parameters<typeof makeCfg>[0]> = {}) {
  return makeCfg(overrides);
}
function makeCfg(overrides: Record<string, unknown> = {}) {
  return {
    provider: "test-nvidia",
    model: "meta/test-model",
    apiKey: SECRET_KEY,
    baseUrl: "https://llm.test/v1",
    timeoutMs: 5000,
    ...overrides,
  };
}

const MESSAGES: ChatMessage[] = [{ role: "user", content: "Ludhiana se Delhi trains" }];

function transportReturning(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    }),
  ) as unknown as typeof fetch;
}

describe("OpenAiCompatibleClient.chat", () => {
  it("sends model/messages/tools with bearer auth to <base>/chat/completions", async () => {
    const transport = transportReturning({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      model: "meta/test-model",
    });
    const capture: { url?: string; init?: RequestInit } = {};
    const wrapped = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capture.url = String(url);
      capture.init = init;
      return transport(url, init);
    }) as unknown as typeof fetch;

    const res = await new OpenAiCompatibleClient(cfg(), wrapped).chat({
      messages: MESSAGES,
      tools: [{ type: "function", function: { name: "T", description: "d", parameters: {} } }],
    });

    expect(capture.url).toBe("https://llm.test/v1/chat/completions");
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    const body = JSON.parse(String(capture.init?.body));
    expect(body.model).toBe("meta/test-model");
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
    expect(res.content).toBe("hello");
    expect(res.toolCalls).toEqual([]);
  });

  it("parses tool calls and surfaces malformed argument JSON as args:null", async () => {
    const res = await new OpenAiCompatibleClient(
      cfg(),
      transportReturning({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", type: "function", function: { name: "SEARCH_TRAINS", arguments: '{"from":"LDH","to":"DLI","date":"2026-10-11"}' } },
                { id: "c2", type: "function", function: { name: "CHECK_PNR", arguments: "{'broken':" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    ).chat({ messages: MESSAGES });

    expect(res.toolCalls[0]?.args).toEqual({ from: "LDH", to: "DLI", date: "2026-10-11" });
    expect(res.toolCalls[1]?.args).toBeNull();
    expect(res.toolCalls[1]?.rawArguments).toContain("broken");
  });

  it("maps 429 to a retryable rate-limit error", async () => {
    const client = new OpenAiCompatibleClient(cfg(), transportReturning({}, { status: 429, headers: { "retry-after": "7" } }));
    await expect(client.chat({ messages: MESSAGES })).rejects.toMatchObject({
      code: "LLM_RATE_LIMITED",
      retryable: true,
    });
  });

  it("maps 5xx to retryable and 4xx to non-retryable provider errors", async () => {
    const c500 = new OpenAiCompatibleClient(cfg(), transportReturning({}, { status: 503 }));
    await expect(c500.chat({ messages: MESSAGES })).rejects.toMatchObject({ code: "LLM_PROVIDER_ERROR", retryable: true });
    const c400 = new OpenAiCompatibleClient(cfg(), transportReturning({}, { status: 400 }));
    await expect(c400.chat({ messages: MESSAGES })).rejects.toMatchObject({ code: "LLM_PROVIDER_ERROR", retryable: false });
  });

  it("times out honestly with LlmTimeoutError", async () => {
    // Behaves like real fetch: never responds, but rejects when aborted.
    const hanging = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    ) as unknown as typeof fetch;
    const client = new OpenAiCompatibleClient(cfg({ timeoutMs: 60 }), hanging);
    await expect(client.chat({ messages: MESSAGES })).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it("never includes the API key in error messages", async () => {
    const client = new OpenAiCompatibleClient(cfg(), transportReturning({}, { status: 500 }));
    try {
      await client.chat({ messages: MESSAGES });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET_KEY);
      expect(e).toBeInstanceOf(LlmProviderError);
    }
  });

  it("rejects malformed payloads (no choices)", async () => {
    const client = new OpenAiCompatibleClient(cfg(), transportReturning({ foo: 1 }));
    await expect(client.chat({ messages: MESSAGES })).rejects.toBeInstanceOf(LlmMalformedResponseError);
  });
});

describe("OpenAI-compatible adapter — NVIDIA configuration compatibility (Prompt 3 §4)", () => {
  const NVIDIA_ENV = {
    NODE_ENV: "test",
    LLM_PROVIDER: "nvidia",
    LLM_MODEL: "meta/muse-glimmer-30b",
    LLM_API_KEY: "nvapi-compat-test-key",
    LLM_BASE_URL: "https://integrate.api.nvidia.com/v1",
  } as NodeJS.ProcessEnv;

  it("routes NVIDIA config to <base>/chat/completions with the exact model id", async () => {
    const cfg = readLlmConfigs(NVIDIA_ENV).primary!;
    const capture: { url?: string; init?: RequestInit } = {};
    const wrapped = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capture.url = String(url);
      capture.init = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await new OpenAiCompatibleClient(cfg, wrapped).chat({
      messages: MESSAGES,
      tools: [{ type: "function", function: { name: "T", description: "d", parameters: {} } }],
    });
    expect(capture.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(JSON.parse(String(capture.init?.body)).model).toBe("meta/muse-glimmer-30b");
  });

  it("parses the exact NVIDIA tool_calls payload shape observed in live runs", async () => {
    const cfg = readLlmConfigs(NVIDIA_ENV).primary!;
    // Verbatim structure captured from the live NVIDIA endpoint (key redacted).
    const nvidiaPayload = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "chatcmpl-tool-a3609c81ffeecf73",
                type: "function",
                function: {
                  name: "SEARCH_TRAINS",
                  arguments: '{"from": "Ludhiana", "to": "Delhi", "date": "2026-10-11"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const res = await new OpenAiCompatibleClient(cfg, transportReturning(nvidiaPayload)).chat({
      messages: MESSAGES,
    });
    expect(res.finishReason).toBe("tool_calls");
    expect(res.toolCalls[0]).toMatchObject({
      name: "SEARCH_TRAINS",
      args: { from: "Ludhiana", to: "Delhi", date: "2026-10-11" },
    });
  });
});

describe("LLM config from env", () => {
  const ENV = {
    NODE_ENV: "test",
    LLM_PROVIDER: "nvidia",
    LLM_MODEL: "meta/muse-glimmer-30b",
    LLM_API_KEY: SECRET_KEY,
    LLM_BASE_URL: "https://integrate.api.nvidia.com/v1/",
    LLM_FALLBACK_MODEL: "openai/gpt-oss-20b",
    LLM_FALLBACK_API_KEY: "nvapi-fallback-test",
    LLM_FALLBACK_BASE_URL: "https://integrate.api.nvidia.com/v1",
  } as NodeJS.ProcessEnv;

  it("reads primary and fallback endpoints; strips trailing slashes", () => {
    const { primary, fallback } = readLlmConfigs(ENV);
    expect(primary?.model).toBe("meta/muse-glimmer-30b");
    expect(primary?.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(fallback?.model).toBe("openai/gpt-oss-20b");
  });

  it("returns null endpoints when credentials are missing (no silent defaults)", () => {
    const { primary, fallback } = readLlmConfigs({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(primary).toBeNull();
    expect(fallback).toBeNull();
  });

  it("drops a fallback identical to the primary", () => {
    const { fallback } = readLlmConfigs({
      ...ENV,
      LLM_FALLBACK_MODEL: ENV.LLM_MODEL,
      LLM_FALLBACK_API_KEY: ENV.LLM_API_KEY,
    } as NodeJS.ProcessEnv);
    expect(fallback).toBeNull();
  });

  it("describeLlmConfigs never exposes key material", () => {
    const described = JSON.stringify(describeLlmConfigs(ENV));
    expect(described).not.toContain(SECRET_KEY);
    expect(described).not.toContain("nvapi-fallback-test");
    expect(described).toContain("meta/muse-glimmer-30b");
  });
});
