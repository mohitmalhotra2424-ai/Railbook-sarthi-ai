import { expect, test } from "@playwright/test";

/**
 * PROMPT 45 — passenger details live on their own IRCTC-style NEXT PAGE
 * (/passengers), never inside the chat (TEST FIXTURES, clearly labelled).
 * The e2e server has no LLM credentials, so form state arrives via a fixture
 * SSE stream; page reads/edits are answered by a fixture /api/passenger.
 * Real LLM-driven collection is verified by unit tests (prompt45 suite) and
 * live runs. Booking stays disabled — this covers data collection only.
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

const INCOMPLETE = { ready: false, missingFields: ["passenger 1: age"], blockers: [{ code: "PASSENGER_INCOMPLETE", detail: "Passenger 1 is missing: age, gender, berth." }], warnings: [] };
const COMPLETE = { ready: true, missingFields: [], blockers: [], warnings: [] };

function sseWithForm(passengers: unknown[]) {
  return [
    { type: "conversation", conversationId: "p45-fixture-conv-1" },
    { type: "passenger_form", selection: SELECTION, passengers, readiness: INCOMPLETE, review: null },
    { type: "message", text: "Form agle page par khul gaya — age bataiye.", model: "fixture", viaFallback: false, cards: [] },
    { type: "done" },
  ]
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n")
    .concat("\n\n");
}

function passengerApi(page: import("@playwright/test").Page, initial: unknown[], readiness: unknown = INCOMPLETE) {
  const state = { passengers: initial as Record<string, unknown>[] };
  return page.route("**/api/passenger**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, selection: SELECTION, passengers: state.passengers, readiness, review: null, fare: null, availability: null, times: null }),
      });
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    if (body.action === "add") {
      state.passengers.push({ category: body.category ?? "passenger", nationality: "India" });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, selection: SELECTION, passengers: state.passengers, readiness, review: null }) });
      return;
    }
    if (body.field === "age" && body.value === "280") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Age must be a whole number between 1 and 120." }) });
      return;
    }
    const idx = Number(body.passengerIndex ?? 1) - 1;
    if (body.field && state.passengers[idx]) state.passengers[idx][String(body.field)] = body.value;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, selection: SELECTION, passengers: state.passengers, readiness, review: null }) });
  });
}

test("Prompt 45: selecting train+class opens the IRCTC-style passenger PAGE (not the chat); edits flow through the validated path", async ({ page }) => {
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma", nationality: "India" }]) }),
  );
  await passengerApi(page, [{ name: "Rahul Sharma", nationality: "India" }]);

  await page.goto("/chat");
  await page.getByLabel("Message").fill("3A mein select karo");
  await page.getByRole("button", { name: "Send" }).click();

  // 1) Auto-navigates to the dedicated passenger page — the form is NOT in chat
  await page.waitForURL("**/passengers**", { timeout: 10_000 });
  await expect(page.getByTestId("passenger-page")).toBeVisible();
  await expect(page.getByTestId("passenger-card-0")).toBeVisible();
  await expect(page.getByTestId("name-0")).toHaveValue("Rahul Sharma");

  // 2) IRCTC-style controls: gender + nationality + berth selects, add buttons,
  //    the official under-5 children rule note, and the booking-disabled label
  await expect(page.getByTestId("gender-0")).toBeVisible();
  await expect(page.getByTestId("nationality-0")).toHaveValue("India");
  await expect(page.getByTestId("berth-0")).toBeVisible();
  await expect(page.getByTestId("add-passenger")).toBeVisible();
  await expect(page.getByTestId("add-infant-with-berth")).toBeVisible();
  await expect(page.getByTestId("add-infant-without-berth")).toBeVisible();
  await expect(page.getByTestId("children-rule-note")).toContainText("under 5 years");
  await expect(page.getByTestId("children-rule-note")).toContainText("full adult fare");

  // 3) Invalid edit rejected by the SAME validation as chat (fixture 400)
  const age = page.getByTestId("age-0");
  await age.fill("280");
  await age.blur();
  await expect(page.locator("text=Age must be a whole number")).toBeVisible({ timeout: 5_000 });

  // 4) Valid edit persists and re-renders from the authoritative snapshot
  await age.fill("28");
  await age.blur();
  await expect.poll(async () => (await age.inputValue()) === "28").toBe(true);
});

test("Prompt 45: infant without berth needs no berth; + Add Infant Without Berth creates one with the free-travel label", async ({ page }) => {
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma", age: 30, gender: "male", berth: "Lower Berth" }]) }),
  );
  await passengerApi(page, [{ name: "Rahul Sharma", age: 30, gender: "male", berth: "Lower Berth" }]);

  await page.goto("/chat");
  await page.getByLabel("Message").fill("select karo");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL("**/passengers**", { timeout: 10_000 });

  await page.getByTestId("add-infant-without-berth").click();
  await expect(page.getByTestId("passenger-card-1")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("passenger-card-1")).toContainText("Infant (no berth — free)");
  await expect(page.getByTestId("berth-1")).toContainText("Not applicable");
});

test("Prompt 45: Proceed to Review is gated on readiness; complete details unlock the review page link", async ({ page }) => {
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm([{ name: "Rahul Sharma", nationality: "India" }]) }),
  );
  await passengerApi(page, [{ name: "Rahul Sharma", nationality: "India" }]);

  await page.goto("/chat");
  await page.getByLabel("Message").fill("select karo");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL("**/passengers**", { timeout: 10_000 });

  // Incomplete → blocker listed, review link disabled (no false readiness)
  await expect(page.getByTestId("proceed-to-review")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("text=Passenger 1 is missing: age, gender, berth.")).toBeVisible();
});

test("Prompt 45: with complete authoritative details the review link points at the review page", async ({ page }) => {
  const full = [{ name: "Rahul Sharma", age: 30, gender: "male", berth: "Lower Berth", nationality: "India" }];
  await page.route("**/api/assistant", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseWithForm(full) }),
  );
  await passengerApi(page, full, COMPLETE);

  await page.goto("/chat");
  await page.getByLabel("Message").fill("select karo");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForURL("**/passengers**", { timeout: 10_000 });

  const link = page.getByTestId("proceed-to-review");
  await expect(link).toHaveAttribute("aria-disabled", "false");
  await expect(link).toHaveAttribute("href", /\/review\?c=p45-fixture-conv-1/);
  await link.click();
  await page.waitForURL("**/review**");
});

test("same assistant SSE save event updates passenger fields without refetch or remount", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/passenger**", (route) => {
    reads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ selection: SELECTION, passengers: [{ name: "Mohit", age: 30 }], readiness: INCOMPLETE }) });
  });
  await page.route("**/api/assistant", (route) => {
    expect(route.request().postDataJSON().conversationId).toBe("p45-fixture-conv-1");
    return route.fulfill({ contentType: "text/event-stream", body: sseWithForm([{ name: "Mohit", age: 30, gender: "male", berth: "Lower" }]) });
  });
  await page.goto("/passengers?c=p45-fixture-conv-1");
  await expect(page.getByTestId("gender-0")).toHaveValue("");
  await page.getByRole("button", { name: "Fill by voice / chat" }).click();
  const before = reads;
  await page.getByLabel("Message").fill("Male, lower berth");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("gender-0")).toHaveValue("male");
  await expect(page.getByTestId("berth-0")).toHaveValue("Lower");
  expect(reads).toBe(before); // update arrived from SSE, not interval polling
  await expect(page).toHaveURL(/\/passengers/);
  await expect(page.getByTestId("new-chat")).toBeDisabled(); // cannot silently switch session under form
});

test("server-updated name and age replace initial values without remount", async ({ page }) => {
  await page.route("**/api/passenger**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ selection: SELECTION, passengers: [{ name: "Mohit", age: 30 }], readiness: INCOMPLETE }) }));
  await page.route("**/api/assistant", (route) => route.fulfill({ contentType: "text/event-stream", body: sseWithForm([{ name: "Mohit Kumar", age: 31 }]) }));
  await page.goto("/passengers?c=p45-fixture-conv-1");
  await expect(page.getByTestId("name-0")).toHaveValue("Mohit");
  await page.getByRole("button", { name: "Fill by voice / chat" }).click();
  await page.getByLabel("Message").fill("Name Mohit Kumar, age 31");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("name-0")).toHaveValue("Mohit Kumar");
  await expect(page.getByTestId("age-0")).toHaveValue("31");
});

test("voice transcript on the passenger page uses the same assistant session and updates the visible form", async ({ page }) => {
  await page.addInitScript(`
    class Recognition {
      constructor() { window.__p45rec = this; }
      start() { if (this.onstart) this.onstart(); }
      abort() { if (this.onend) this.onend(); }
      stop() { if (this.onend) this.onend(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable:true, value:Recognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable:true, value:Recognition });
  `);
  await page.route("**/api/passenger**", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ selection: SELECTION, passengers: [{ name: "Mohit", age: 30 }], readiness: INCOMPLETE }) }));
  let calls = 0;
  await page.route("**/api/assistant", (r) => {
    calls++;
    expect(r.request().postDataJSON().conversationId).toBe("p45-fixture-conv-1");
    expect(r.request().postDataJSON().message).toContain("लोअर");
    return r.fulfill({ contentType: "text/event-stream", body: sseWithForm([{ name: "Mohit", age: 30, gender: "male", berth: "लोअर बर्थ" }]) });
  });
  await page.goto("/passengers?c=p45-fixture-conv-1");
  await page.getByRole("button", { name: "Fill by voice / chat" }).click();
  await page.getByTestId("mic-button").click();
  await page.evaluate(() => {
    const w = window as unknown as { __p45rec: { onresult: (e: unknown) => void; onend: () => void } };
    w.__p45rec.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: "पुरुष, लोअर बर्थ" } } } });
    w.__p45rec.onend();
  });
  await expect(page.getByLabel("Message")).toHaveValue("पुरुष, लोअर बर्थ");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("gender-0")).toHaveValue("male");
  await expect(page.getByTestId("berth-0")).toHaveValue("लोअर बर्थ");
  expect(calls).toBe(1);
});
