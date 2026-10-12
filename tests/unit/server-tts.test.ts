/**
 * PROMPT 34 addendum — server-side TTS integration (deterministic, mocked
 * transport). The credential used here is a TEST-ONLY fake; the real secret
 * lives solely in server-side env and is never printed or committed.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { synthesizeSpeech } from "@/assistant/voice/tts";
import { readTtsConfig } from "@/assistant/voice/tts-config";
import { GET, POST } from "@/app/api/voice/speech/route";

const ENV_KEYS = ["VOICE_TTS_PROVIDER", "VOICE_TTS_BASE_URL", "VOICE_TTS_API_KEY", "VOICE_TTS_MODEL", "VOICE_TTS_VOICE"] as const;

function setEnv() {
  process.env.VOICE_TTS_PROVIDER = "openai";
  process.env.VOICE_TTS_BASE_URL = "https://tts.example.test/v1";
  process.env.VOICE_TTS_API_KEY = "test-only-fake-key";
  process.env.VOICE_TTS_MODEL = "tts-1";
  process.env.VOICE_TTS_VOICE = "hi-IN-SwaraNeural";
}
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

const AUDIO = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // fake wav header bytes

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

beforeEach(() => clearEnv());
afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
});

it("config reads all five server env values; missing pieces mean not-configured", () => {
  expect(readTtsConfig()).toBeNull();
  setEnv();
  const cfg = readTtsConfig();
  expect(cfg).toMatchObject({ provider: "openai", model: "tts-1", voice: "hi-IN-SwaraNeural", baseUrl: "https://tts.example.test/v1" });
  delete process.env.VOICE_TTS_VOICE;
  expect(readTtsConfig()).toBeNull();
});

it("sends the configured model+voice over the verified OpenAI-compatible contract", async () => {
  setEnv();
  stubFetch(async (url, init) => {
    expect(url).toBe("https://tts.example.test/v1/audio/speech");
    const body = JSON.parse(String(init?.body)) as { model: string; voice: string; input: string };
    expect(body.model).toBe("tts-1");
    expect(body.voice).toBe("hi-IN-SwaraNeural");
    expect(body.input).toBe("नमस्ते");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-only-fake-key");
    return new Response(new Uint8Array(AUDIO), { headers: { "content-type": "audio/mpeg" } });
  });
  const r = await synthesizeSpeech("नमस्ते");
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.contentType).toBe("audio/mpeg");
    expect(r.audio.length).toBe(AUDIO.length);
  }
});

const codeOf = async (text: string) => {
  const r = await synthesizeSpeech(text);
  return r.ok ? "ok" : r.code;
};

it("auth failure, HTTP errors, non-audio and empty audio all fail honestly", async () => {
  setEnv();
  stubFetch(async () => new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }));
  expect(await codeOf("hi")).toBe("auth");

  stubFetch(async () => new Response("boom", { status: 500 }));
  expect(await codeOf("hi")).toBe("http");

  stubFetch(async () => new Response("not audio", { headers: { "content-type": "text/plain" } }));
  expect(await codeOf("hi")).toBe("invalid_audio");

  stubFetch(async () => new Response(new Uint8Array(0), { headers: { "content-type": "audio/mpeg" } }));
  expect(await codeOf("hi")).toBe("invalid_audio");

  stubFetch(async () => Promise.reject(new DOMException("aborted", "AbortError")));
  expect(await codeOf("hi")).toBe("timeout");

  clearEnv();
  expect(await codeOf("hi")).toBe("not_configured");
});

it("route: 503 when not configured; audio passthrough when configured; no credential in any response", async () => {
  const un = await POST(new Request("http://local/api/voice/speech", { method: "POST", body: JSON.stringify({ text: "hello" }) }));
  expect(un.status).toBe(503);
  expect(await un.text()).not.toContain("test-only-fake-key");

  setEnv();
  stubFetch(async () => new Response(new Uint8Array(AUDIO), { headers: { "content-type": "audio/wav" } }));
  const ok = await POST(new Request("http://local/api/voice/speech", { method: "POST", body: JSON.stringify({ text: "hello" }) }));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("audio/wav");
  const bytes = Buffer.from(await ok.arrayBuffer());
  expect(bytes.length).toBe(AUDIO.length);

  const bad = await POST(new Request("http://local/api/voice/speech", { method: "POST", body: JSON.stringify({ text: "   " }) }));
  expect(bad.status).toBe(400);

  const probe = await GET();
  const probeBody = await probe.text();
  expect(probeBody).toContain('"configured":true');
  expect(probeBody).not.toContain("test-only-fake-key");
});
