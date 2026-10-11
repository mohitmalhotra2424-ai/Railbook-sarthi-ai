import { expect, test } from "@playwright/test";

/**
 * PROMPT 25 — passenger form UI wiring (TEST FIXTURES, clearly labelled).
 * The e2e server has no LLM credentials, so the form state arrives via a
 * fixture SSE stream; manual edits are answered by a fixture /api/passenger.
 * Real LLM-driven selection is verified separately by live/unit tests.
 */

const SELECTION = {
  trainNumber: "12951",
  trainName: "Morning Express",
  from: "LDH",
  to: "NDLS",
  journeyDate: "2026-10-12",
  classes: ["SL", "3A", "2A"],
  classCode: "3A",
  selectedAt: "2026-10-11T00:00:00.000Z",
};

function sseWithForm(passengers: unknown[]) {
  return [
    { type: "conversation", conversationId: "p25-fixture-conv-1" },
    { type: "passenger_form", selection: SELECTION, passengers },
    { type: "message", text: "Form khul gaya — age bataiye.", model: "fixture", viaFallback: false, cards: [] },
    { type: "done" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

test("passenger form opens automatically from backend form-state event; manual edits go through the validated path", async ({ page }) => {
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma" }]) }),
  );
  // Fixture answers for the manual-edit endpoint (server store is empty in e2e)
  await page.route("**/api/passenger", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { field?: string; value?: string };
    if (body.field === "age" && body.value === "280") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Age must be a whole number between 1 and 120." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, selection: SELECTION, passengers: [{ name: "Rahul Sharma", age: 28 }] }),
    });
  });

  await page.goto("/chat");
  await page.getByLabel("Message").fill("3A mein select karo");
  await page.getByRole("button", { name: "Send" }).click();

  // 1) Form opens automatically once train+class are selected (fixture state)
  const form = page.getByTestId("passenger-form");
  await expect(form).toBeVisible({ timeout: 10_000 });
  await expect(form).toContainText("12951");
  await expect(form).toContainText("3A");
  await expect(form).toContainText("booking disabled");

  // 2) Completed field shows its value; the next required field is highlighted
  await expect(page.getByLabel("Passenger 1 Name")).toHaveValue("Rahul Sharma");
  await expect(page.getByTestId("form-next-field")).toBeVisible();

  // 3) Unsupported capabilities are labelled, not faked
  await expect(form).toContainText("Food preference: not supported");
  await expect(form).toContainText("no authorised provider verifies berth options");
  await expect(form.getByLabel(/Food/i)).toHaveCount(0); // no food field exists

  // 4) Invalid manual edit is rejected WITHOUT corrupting state
  const age = page.getByLabel("Passenger 1 Age");
  await age.fill("280");
  await age.blur();
  await expect(page.getByTestId("form-field-error")).toContainText("Age must be a whole number");
  await expect(age).toHaveValue("280"); // UI keeps the typed value for correction; state unchanged

  // 5) Valid manual edit flows through the validated path and updates the form
  await age.fill("28");
  await age.blur();
  await expect(page.getByTestId("form-field-error")).toHaveCount(0);
  await expect(page.getByLabel("Passenger 1 Age")).toHaveValue("28");
});

test("New Chat clears the passenger form — no state leak into a fresh conversation", async ({ page }) => {
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma", age: 28, gender: "male" }]) }),
  );

  await page.goto("/chat");
  await page.getByLabel("Message").fill("select karo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("passenger-form")).toBeVisible({ timeout: 10_000 });

  const newChat = page.getByTestId("new-chat");
  await newChat.click();
  await newChat.click();
  await expect(page.getByTestId("passenger-form")).toHaveCount(0);
  await expect(page.getByLabel("Passenger 1 Name")).toHaveCount(0);
});

test("Prompt 30: journey review shows authoritative selection + per-passenger completion, never fabricated data", async ({ page }) => {
  // Incomplete passenger: review must name the exact missing fields.
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma" }]) }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("select karo");
  await page.getByRole("button", { name: "Send" }).click();

  const review = page.getByTestId("journey-review");
  await expect(review).toBeVisible({ timeout: 10_000 });
  await expect(review).toContainText("12951 — Morning Express");
  await expect(review).toContainText("2026-10-12");
  await expect(review).toContainText("LDH → NDLS");
  await expect(review).toContainText("3A");
  await expect(page.getByTestId("review-pax-1")).toContainText("missing: age, gender");
  await expect(page.getByTestId("review-ready")).toHaveCount(0); // not complete, no false readiness

  // Complete passenger (fresh load): readiness shown honestly, booking still disabled.
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma", age: 28, gender: "male" }]) }),
  );
  await page.goto("/chat");
  await page.getByLabel("Message").fill("select karo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("review-pax-1")).toContainText("Passenger 1 complete");
  await expect(page.getByTestId("review-ready")).toContainText("booking execution is disabled");
});
