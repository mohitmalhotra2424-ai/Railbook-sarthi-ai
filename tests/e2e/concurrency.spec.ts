import { expect, test } from "@playwright/test";

/**
 * PROMPT 19 — UI-level request isolation.
 * Deterministic: the LLM endpoint is intercepted with a test-controlled gate
 * (delayed / out-of-order responses). No live LLM calls are made here.
 */

test("rapid double-tap on Send fires exactly ONE provider request", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/assistant", async (route) => {
    requests += 1;
    await new Promise((r) => setTimeout(r, 2_500)); // hold the turn open
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "LLM_NOT_CONFIGURED", message: "test", retryable: false } }),
    });
  });

  await page.goto("/chat");
  await page.getByLabel("Message").fill("Kal Ludhiana se Delhi ki trains");
  const send = page.getByRole("button", { name: "Send" });
  await send.click();
  await send.click({ force: true }); // second tap while the first is in flight

  await page.waitForTimeout(1_500);
  expect(requests).toBe(1); // no duplicate LLM/provider execution
  await expect(page.getByTestId("chat-message-user")).toHaveCount(1);
});

test("New Chat during an in-flight turn drops the delayed response entirely", async ({ page }) => {
  let releaseFn: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });

  await page.route("**/api/assistant", async (route) => {
    await gate; // simulate a slow LLM turn
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"conversation","conversationId":"ghost-old-1"}\n\n' +
        'data: {"type":"message","text":"PURANI JAWAB — delayed ghost reply"}\n\n',
    });
  });

  await page.goto("/chat");
  await page.getByLabel("Message").fill("Purana sawaal, jawab dheere aayega");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-thinking").first()).toBeVisible({ timeout: 10_000 });

  // New Chat while the old turn is still pending (two-tap confirm)
  const newChat = page.getByTestId("new-chat");
  await newChat.click();
  await newChat.click();
  await expect(page.getByTestId("chat-message-user")).toHaveCount(0);

  // The old turn finally answers — it must NOT appear in the new conversation
  releaseFn?.();
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("chat-log")).not.toContainText("PURANI JAWAB");
  await expect(page.getByTestId("chat-message-user")).toHaveCount(0);

  // The old conversationId must not be resurrected into storage
  const cid = await page.evaluate(() => localStorage.getItem("railsaarthi.cid"));
  expect(cid === null || cid === "").toBe(true);
});

test("network interruption shows an honest retryable error; Retry recovers the turn", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/assistant", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.abort(); // simulate dropped network mid-turn
      return;
    }
    // "Network is back" — server responds honestly (e2e runs without LLM creds)
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'data: {"type":"conversation","conversationId":"resil-conv-1"}\n\n' +
        'data: {"type":"error","code":"LLM_NOT_CONFIGURED","message":"LLM is not configured.","retryable":true}\n\n' +
        'data: {"type":"done"}\n\n',
    });
  });

  await page.goto("/chat");
  await page.getByLabel("Message").fill("Ludhiana se Delhi");
  await page.getByRole("button", { name: "Send" }).click();

  const error = page.getByTestId("chat-error");
  await expect(error).toBeVisible({ timeout: 10_000 });
  await expect(error).toContainText("NETWORK_ERROR");

  const retry = page.getByTestId("retry-button");
  await expect(retry).toBeEnabled();
  await retry.click();

  await expect(page.getByTestId("chat-error").last()).toContainText("LLM_NOT_CONFIGURED", { timeout: 10_000 });
  expect(calls).toBe(2); // retried exactly once
  // Still no fabricated railway data anywhere
  await expect(page.getByTestId("train-cards")).toHaveCount(0);
});
