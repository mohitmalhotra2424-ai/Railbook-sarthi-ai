import { expect, test } from "@playwright/test";

test("/api/health exposes configuration status without secrets", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();

  const raw = await res.text();
  const json = JSON.parse(raw);

  expect(json.llm.configured).toBe(false);
  expect(json.booking.enabled).toBe(false);
  expect(json.booking.integrationPresent).toBe(false);
  expect(json.railway.capabilities).toHaveLength(8);
  expect(
    json.railway.capabilities.every((c: { configured: boolean }) => c.configured === false),
  ).toBe(true);

  // No env var names or key material anywhere in the payload.
  expect(raw).not.toMatch(/API_KEY/);
  expect(raw).not.toMatch(/\bsk-[A-Za-z0-9_-]{8,}/);
});
