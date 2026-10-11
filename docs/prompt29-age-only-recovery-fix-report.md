# Prompt 29 — Age-Only Tool Argument Type Compatibility Fix
## Report

Date: 2026-10-11 · Baseline: `main` @ `816e4ab` (P28), working tree clean at start; P28 recovery implementation verified present before any edit.

> Narrow compatibility fix only. Booking, payment, cancellation execution, ticket issuance, IRCTC login, OTP and CAPTCHA remain disabled. No push, deploy, or production change.

---

## 1. Files changed and why

| File | Change |
|---|---|
| `src/assistant/tools/schemas.ts` | `UpdatePassengerArgs.value` widened from `z.string().min(1)` to `z.union([z.string().min(1), z.number().int()])`, plus a `superRefine` that (a) REJECTS any numeric value for every field except `age`, and (b) normalizes an integer age to its string form (`28` → `"28"`). Zod-4 `superRefine` keeps the schema a `ZodObject`, so `.shape` introspection and the existing schema↔JSON sync test remain valid. The JSON schema shown to the model, all other tools' schemas, the general parser and the dispatcher are unchanged. |
| `src/assistant/orchestrator.ts` | One condition change: the P28 recovery trigger now requires `missingNow.includes("age") && blockedClaims.some(b => b.field === "age")` — replacing the previous any-blocked-field eligibility. Recovery is strictly age-only. |
| `tests/unit/p29-age-compat.test.ts` | NEW — deterministic Tests A–N (15 tests, mocked doubles). |
| `scripts/live-selection.mjs` | Added turn L5b (gender) so the bounded live check verifies the FULL required auto-fill chain (name → age → gender), per the owner's verification request. |

## 2. Exact age-only recovery eligibility (all must hold)

1. The turn belongs to the passenger-form flow — the P26 guard blocked a save claim **whose field is `age`** (`blockedClaims.some(b => b.field === "age")`).
2. The form is open and the session verified: `selection.classCode` set in the authoritative `ConversationStore` snapshot.
3. Age is authoritatively still missing on the current passenger (`REQUIRED_PASSENGER_FIELDS` check).
4. No recovery used this turn (`recoveryUsed`) and the `MAX_TOOL_ITERATIONS` budget remains.

Explicitly ineligible (each proven by test): name, gender, berth, "details" claims (F, G); train selection/search/timetable/live/fare/availability/PNR/cancellations and general Q&A (H); already-saved age (I); closed form / cleared session (P26 suite Test F re-verified in the full run). One-request-per-turn limit unchanged (J). No keyword routing, no new agent/store/orchestrator.

## 3. The compatibility fix and validation behaviour

Data path: recovery LLM response → `client.chat` parses `tool_calls` → `executeTool` → `TOOL_ARG_SCHEMAS.UPDATE_PASSENGER.safeParse` (the fix point) → `validatePassengerField("age", value)` → `validateAge` → `ConversationStore.updatePassenger` → authoritative state.

- Only `field:"age"` + **integer** number is normalized to the existing string contract; the normalized value then passes through the **unchanged** `validateAge` (whole number, 1–120).
- Rejected (test D + C + M2): floats (`28.5`, `-2.5`), booleans, `null`, arrays, objects, numeric values for name/gender/berth, out-of-range (`280`, `0`, `-5`, and `121` rejected at execution by `validateAge`), malformed/empty strings.
- Nothing is saved before authoritative update success; the P26 guard's evidence rules are untouched (test L: identical sentence blocked before evidence, permitted after).
- The general argument parser and all unrelated tool schemas are untouched; `GET_TRAIN_INFO`'s pre-existing numeric-tolerance (`numericString` union, present since before this milestone — verified via git diff: zero changes) is baseline behaviour, now explicitly pinned by test M.

## 4. Evidence that nothing else can trigger the recovery

- Unit: F (gender + name-mismatch claims → exactly 1 LLM request each, fallback delivered), G (berth claim → 1 request), H (search tool turn = 2 requests as normal; Q&A = 1 request), I (saved age → 1 request), J (two blocked age claims → exactly 2 requests, never 3).
- Full suite: the entire P26 guard suite and P27 diagnosis suite pass unchanged — including the closed-form case where recovery must not fire.
- Live: the log shows a blocked `name` claim (`blockedFields:["name"]`) on turn L7 that correctly produced **no** recovery re-ask, while the blocked `age` claim on L5 produced exactly one.

## 5. Test results

| Check | Result |
|---|---|
| Focused `p29-age-compat.test.ts` (A–N, incl. M2) | **15/15 PASS** (all mocked/deterministic) |
| Full unit suite | **274 passed**, 6 skipped (259 baseline + 15 new; **0 regressions**) — incl. schema↔JSON sync test |
| `npx playwright test` (4 viewports) | **190/190** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 0 warnings |
| `npx next build` | clean |

New failures vs baseline: none. (One interim failure — the schema-sync test tripping over a `z.preprocess` wrapper — was resolved by switching to the `superRefine` design, not by touching the test.)

### Live verification (ONE bounded run — answers the owner's question directly)

`scripts/live-selection.mjs` with the new L5b gender turn: **9/9 PASS — first fully green live run.**

- L4 name saved → L5: the model omitted the age tool call again (`stop`, 0 tool calls); the guard blocked the false claim; **one** recovery re-ask fired; the model called `UPDATE_PASSENGER` and the **numeric age was accepted** — age 28 saved.
- L5b: gender saved → **"Passenger 1 complete ✅"** with `{"name":"Rahul Sharma","age":28,"gender":"male"}` — the complete required set auto-filled through conversation.
- L6: natural name correction overwrote name only; age + gender retained. L7: food honestly refused; a blocked name claim triggered no recovery (age-only boundary held live).

**Conclusion for the owner's verification request:** yes — verified live, all required passenger details (name, age, gender) are collected and auto-filled into the form through the conversation, and corrections update the right field without disturbing the others.

## 6. Non-change confirmation

Model/provider/settings, general prompts, AI understanding/personality/conversational behaviour, tool-selection behaviour: unchanged. Tool definitions/JSON schemas shown to the model: unchanged (only the server-side zod acceptance of an integer age, age-only, backward-compatible — every previously-valid call remains valid). Parser, dispatcher, orchestration architecture, session/memory architecture, passenger-form design: unchanged beyond the two scoped edits above. P26 guard evidence requirements and honest fallback: unchanged. P28 one-recovery-per-turn limit: unchanged. Booking/payment/IRCTC/OTP/CAPTCHA: still disabled. No push/deploy/production change. Prompt 30 not started.

## 7. Unresolved issues

- The model may still occasionally omit a tool call for **non-age** fields; by design (this milestone's boundary) those turns fall back to the honest P26 message asking the user to repeat — observed once live for a name claim, handled correctly.
- Recovery adds one extra LLM call on affected age turns only (bounded, defect-triggered).
