import { beforeEach, describe, expect, it, vi } from "vitest";
import { anthropicAdapter } from "@/assistant/llm/adapters/anthropic";
import { geminiAdapter } from "@/assistant/llm/adapters/gemini";
import { openaiAdapter } from "@/assistant/llm/adapters/openai";
import { getLlmAdapter, selectedLlmProviderId } from "@/assistant/llm/client";
import { LlmNotConfiguredError, type LlmRequest } from "@/assistant/llm/types";

interface Capture {
  url?: string;
  init?: RequestInit;
}

/** Mocked transport — tests NEVER make live vendor calls. */
function mockTransport(body: unknown, capture: Capture): typeof fetch {
  return vi.fn(async (url: string | URL | globalThis.Request, init?: RequestInit) => {
    capture.url = String(url);
    capture.init = init;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const REQ: LlmRequest = {
  messages: [
    { role: "system", content: "You are RailSaarthi." },
    { role: "user", content: "namaste" },
  ],
};

beforeEach(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
});

describe("openai adapter", () => {
  it("reports not-configured without a key and throws a keyless error", async () => {
    expect(openaiAdapter.isConfigured()).toBe(false);
    await expect(openaiAdapter.complete(REQ)).rejects.toBeInstanceOf(LlmNotConfiguredError);
    try {
      await openaiAdapter.complete(REQ);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/sk-/);
    }
  });

  it("sends bearer auth and parses the completion", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key-123456";
    const capture: Capture = {};
    const result = await openaiAdapter.complete(
      REQ,
      mockTransport({ choices: [{ message: { content: "Namaste!" } }], model: "gpt-test" }, capture),
    );
    expect(result.text).toBe("Namaste!");
    expect(result.providerId).toBe("openai");
    expect(capture.url).toContain("https://api.openai.com/v1/chat/completions");
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-openai-key-123456");
  });

  it("honours OPENAI_BASE_URL and OPENAI_MODEL overrides", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key-123456";
    process.env.OPENAI_BASE_URL = "https://example.internal/v1/";
    process.env.OPENAI_MODEL = "custom-model";
    const capture: Capture = {};
    await openaiAdapter.complete(
      REQ,
      mockTransport({ choices: [{ message: { content: "ok" } }] }, capture),
    );
    expect(capture.url).toBe("https://example.internal/v1/chat/completions");
    expect(JSON.parse(String(capture.init?.body)).model).toBe("custom-model");
  });

  it("raises on HTTP failure without echoing upstream bodies", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key-123456";
    const failing = vi.fn(async () => new Response("secret upstream detail", { status: 503 }));
    await expect(openaiAdapter.complete(REQ, failing as unknown as typeof fetch)).rejects.toThrow(
      /status 503/,
    );
  });
});

describe("anthropic adapter", () => {
  it("reports not-configured without a key", () => {
    expect(anthropicAdapter.isConfigured()).toBe(false);
  });

  it("uses x-api-key, the version header, and a top-level system param", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key-123";
    const capture: Capture = {};
    const result = await anthropicAdapter.complete(
      REQ,
      mockTransport({ content: [{ type: "text", text: "Namaste!" }], model: "claude-test" }, capture),
    );
    expect(result.text).toBe("Namaste!");
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-anthropic-key-123");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(capture.init?.body));
    expect(body.system).toBe("You are RailSaarthi.");
    expect(body.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });
});

describe("gemini adapter", () => {
  it("reports not-configured without a key", () => {
    expect(geminiAdapter.isConfigured()).toBe(false);
  });

  it("sends the key via header — never in the URL — and parses candidates", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key-12345";
    const capture: Capture = {};
    const result = await geminiAdapter.complete(
      REQ,
      mockTransport(
        { candidates: [{ content: { parts: [{ text: "Namaste!" }] } }], modelVersion: "gemini-test" },
        capture,
      ),
    );
    expect(result.text).toBe("Namaste!");
    expect(capture.url).toContain(":generateContent");
    expect(capture.url).not.toContain("test-gemini-key-12345"); // key never in the URL
    const headers = capture.init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-gemini-key-12345");
  });
});

describe("llm client selection", () => {
  it("returns null when LLM_PROVIDER is unset, disabled or invalid", () => {
    expect(selectedLlmProviderId()).toBeNull();
    process.env.LLM_PROVIDER = "disabled";
    expect(selectedLlmProviderId()).toBeNull();
    process.env.LLM_PROVIDER = "openrouter";
    expect(selectedLlmProviderId()).toBeNull();
    expect(getLlmAdapter()).toBeNull();
  });

  it("selects a named adapter only when its key exists", () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(selectedLlmProviderId()).toBe("anthropic");
    expect(getLlmAdapter()).toBeNull(); // selected but no key
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key-123";
    expect(getLlmAdapter()?.id).toBe("anthropic");
  });
});
