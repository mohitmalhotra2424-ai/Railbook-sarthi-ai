import { expect, test } from "@playwright/test";

/**
 * Prompt 8 §9 — chat UI behaviour tests (mobile-360 + desktop-1280 projects).
 *
 * These are AUTOMATED tests. Where a conversation is displayed, the SSE
 * response is a clearly-labelled TEST FIXTURE routed via page.route —
 * fixture data must never be presented as live railway information.
 * The real (unrouted) assistant still exercises its honest no-credentials
 * failure path, as in chat.spec.ts.
 */

test("composer supports safe multiline input: Shift+Enter newline, Enter sends", async ({ page }) => {
  await page.goto("/chat");
  const composer = page.getByLabel("Message");

  await composer.pressSequentially("Line one");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("line two");
  await expect(composer).toHaveValue("Line one\nline two");
  // Shift+Enter must NOT send
  await expect(page.getByTestId("chat-message-user")).toHaveCount(0);

  await composer.press("Enter"); // desktop Enter sends
  const bubble = page.getByTestId("chat-message-user").first();
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  await expect(bubble).toContainText("Line one");
  // (the turn then fails honestly — LLM not configured in E2E)
  await expect(page.getByTestId("chat-error")).toBeVisible({ timeout: 15_000 });
});

test("typed text is preserved in the composer after a failed send", async ({ page }) => {
  await page.goto("/chat");
  const composer = page.getByLabel("Message");
  await composer.fill("Ludhiana se Delhi ki trains batao");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("chat-error")).toBeVisible({ timeout: 15_000 });
  // the user's text comes back so nothing typed is lost
  await expect(composer).toHaveValue("Ludhiana se Delhi ki trains batao");
  // LLM_NOT_CONFIGURED is a NON-retryable failure — the UI must not offer a
  // retry that would deterministically fail again. (Retryable failures do
  // expose retry-button; see ChatClient.)
  await expect(page.getByTestId("retry-button")).toHaveCount(0);
});

test("empty state is honest and helpful; composer and brand are reachable on narrow screens", async ({ page }) => {
  await page.goto("/chat");
  await expect(page.getByRole("link", { name: /रेलसारथी|RailSaarthi/i }).first()).toBeVisible();
  await expect(page.getByText(/Main RailSaarthi/i)).toBeVisible();
  const composer = page.getByLabel("Message");
  await expect(composer).toBeVisible();
  await expect(composer).toBeInViewport();
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeVisible();
  // comfortable tap target on Android (≥40px tall)
  const box = await send.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(40);
});

test("provider-backed results render as cards showing ONLY returned fields (TEST FIXTURE data)", async ({ page }) => {
  // Clearly-labelled fixture SSE stream — NOT live railway data.
  const sse = [
    { type: "conversation", conversationId: "fixture-conv" },
    {
      type: "message",
      text: "Ye rahi trains (TEST FIXTURE).",
      model: "fixture-model",
      viaFallback: false,
      cards: [
        {
          trainNumber: "12014",
          trainName: "ASR SHTBDI (FIXTURE)",
          from: "Amritsar Jn (ASR)",
          to: "New Delhi (NDLS)",
          departure: "04:55",
          arrival: "11:02",
          classes: ["CC", "EC"],
          journeyDate: "2026-10-12",
        },
        {
          trainNumber: "12904",
          trainName: "GOLDEN TEMPLE M (FIXTURE)",
          from: "Amritsar Jn (ASR)",
          to: "New Delhi (NDLS)",
          departure: "18:55",
          arrival: "", // provider did not return an arrival
        },
      ],
    },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");

  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse }),
  );

  await page.goto("/chat");
  await page.getByLabel("Message").fill("Amritsar se Delhi trains (fixture)");
  await page.getByRole("button", { name: "Send" }).click();

  const cards = page.getByTestId("train-cards");
  await expect(cards).toBeVisible({ timeout: 15_000 });
  const items = cards.locator("li");
  await expect(items).toHaveCount(2);

  // full card: every returned field visible (number + name render on separate lines)
  const first = items.nth(0);
  await expect(first).toContainText("12014");
  await expect(first).toContainText("ASR SHTBDI (FIXTURE)");
  await expect(first).toContainText("04:55");
  await expect(first).toContainText("11:02");
  await expect(first.getByTestId("card-classes")).toContainText("CC");
  await expect(first.getByTestId("card-classes")).toContainText("EC");
  await expect(first.getByTestId("card-journey-date")).toHaveText("2026-10-12");

  // missing arrival: labelled with an em-dash, never invented; no classes row
  const second = items.nth(1);
  await expect(second.getByTestId("card-arr")).toHaveText("—");
  await expect(second.getByTestId("card-classes")).toHaveCount(0);
  await expect(second.getByTestId("card-journey-date")).toHaveCount(0);
});

test("accessible labels: composer is a labelled multiline textbox; send button has a name", async ({ page }) => {
  await page.goto("/chat");
  const composer = page.getByLabel("Message");
  await expect(composer).toHaveAttribute("aria-multiline", "true");
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(1);
  // conversation log is exposed as a live region for screen readers
  await expect(page.getByTestId("chat-log")).toHaveAttribute("role", "log");
});
