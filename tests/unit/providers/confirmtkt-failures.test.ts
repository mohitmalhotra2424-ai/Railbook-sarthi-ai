import { afterEach, expect, test, vi } from "vitest";
import { confirmtktAdapter } from "@/providers/adapters/confirmtkt-v1";
import type { QueryContext, TrainSearchProvider } from "@/providers/types";

/**
 * PROMPT 14 §5 — provider failure & recovery mapping (OFFLINE, fetch-stubbed).
 * A failure must NEVER become fake data: data stays null, the error code is
 * honest, and retryability matches the failure class.
 */
const ctx = { locale: "en", requestId: "fail-1" } as QueryContext;
const q = { from: "LDH", to: "NDLS", date: "2026-10-12" };

const stub = (impl: () => Response | Promise<Response> | never) =>
  vi.stubGlobal("fetch", vi.fn(impl));

afterEach(() => vi.unstubAllGlobals());

const search = () => (confirmtktAdapter as unknown as TrainSearchProvider).search(q, ctx);

test("HTTP 429 → RATE_LIMITED, retryable, no data", async () => {
  stub(() => new Response("slow down", { status: 429 }));
  const env = await search();
  expect(env.data).toBeNull();
  expect(env.errors[0]?.code).toBe("RATE_LIMITED");
  expect(env.errors[0]?.retryable).toBe(true);
});

test("HTTP 500 → UPSTREAM_ERROR, retryable, no data", async () => {
  stub(() => new Response("boom", { status: 500 }));
  const env = await search();
  expect(env.data).toBeNull();
  expect(env.errors[0]?.code).toBe("UPSTREAM_ERROR");
  expect(env.errors[0]?.retryable).toBe(true);
});

test("malformed (non-JSON) body → UPSTREAM_ERROR, never fake trains", async () => {
  stub(() => new Response("<html>gateway</html>", { status: 200 }));
  const env = await search();
  expect(env.data).toBeNull();
  expect(env.errors[0]?.code).toBe("UPSTREAM_ERROR");
});

test("network/timeout rejection → UPSTREAM_ERROR retryable", async () => {
  stub(() => Promise.reject(new Error("AbortError: timeout")));
  const env = await search();
  expect(env.data).toBeNull();
  expect(env.errors[0]?.code).toBe("UPSTREAM_ERROR");
  expect(env.errors[0]?.retryable).toBe(true);
});

test("structured API error 4002 (past date) → VALIDATION_FAILED, NOT retryable", async () => {
  stub(() =>
    new Response(JSON.stringify({ error: { code: 4002, message: "Journey date cannot be in the past" } }), {
      status: 400,
    }),
  );
  const env = await search();
  expect(env.data).toBeNull();
  expect(env.errors[0]?.code).toBe("VALIDATION_FAILED");
  expect(env.errors[0]?.retryable).toBe(false);
  // user-safe message, no credentials
  expect(JSON.stringify(env.errors)).not.toMatch(/key|token|secret/i);
});
