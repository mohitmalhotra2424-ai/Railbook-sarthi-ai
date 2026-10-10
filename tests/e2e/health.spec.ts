import { expect, test } from "@playwright/test";

test("/api/health exposes configuration status without secrets", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();

  const raw = await res.text();
  const json = JSON.parse(raw);

  // E2E runs with LLM credentials cleared — reported honestly as null.
  expect(json.llm.primary).toBeNull();
  expect(json.llm.fallback).toBeNull();

  expect(json.booking.enabled).toBe(false);
  expect(json.booking.integrationPresent).toBe(false);
  expect(json.railway.capabilities).toHaveLength(8);
  expect(
    json.railway.capabilities.every((c: { configured: boolean }) => c.configured === false),
  ).toBe(true);

  // No env var names or key material anywhere in the payload.
  expect(raw).not.toMatch(/API_KEY|nvapi-|\bsk-[A-Za-z0-9_-]{8,}/);
});
