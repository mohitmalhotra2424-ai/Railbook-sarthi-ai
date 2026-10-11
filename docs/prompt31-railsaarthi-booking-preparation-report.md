# Prompt 31 — RailSaarthi Booking Preparation Integration
## Report

Date: 2026-10-12 · Baseline: `main` @ `37bf34e` (train+class-gated passenger form), working tree clean at start (only untracked probe screenshots). P27–P30 reports read and their implementations verified in code before any change (age-only recovery boundary, P26 save-claim guard, P28 bounded recovery, P30 journey review).

> This milestone ends at `IRCTC_HANDOFF_READY` — a verified, preparation-only terminal state. Real booking, ticket submission, payment, transactional cancellation, IRCTC login, OTP and CAPTCHA remain disabled. **No push, no deploy, no production change** in this milestone.

---

## 1. Baseline audit — what already exists (architecture mapping)

| P31 responsibility | Existing RailSaarthi component (verified in code) |
|---|---|
| AI orchestrator / LLM flow | `src/assistant/orchestrator.ts` — LLM-first turn loop, tool dispatch, SSE events; unchanged this milestone |
| Railway tools, runtime, providers | `src/assistant/tools/{schemas,executor,results}.ts`, `src/providers/**` — unchanged |
| Booking/session state & memory | `src/assistant/context/store.ts` — `Conversation` (journey, selection, passengers, result refs, supersede/invalidation) |
| Train search / selection UI | `src/components/TrainResultCards.tsx` (tap `Select train` / class chips → same chat turn; LLM `SELECT_TRAIN`/`SELECT_CLASS` remain authoritative) |
| Passenger form, schema, validation, autofill | `src/components/PassengerFormPanel.tsx`, `src/assistant/passengers/validate.ts`, `/api/passenger` (same validators for chat, voice and manual edits) |
| P26 save-claim guard | `src/assistant/passengers/save-claim-guard.ts` + orchestrator wiring — unchanged |
| P28 bounded recovery / P29 age-only | orchestrator L~330-350 boundary + `tests/unit/p29-*` — unchanged, re-run green |
| P30 review | `PassengerFormPanel` "Journey review" block rendering authoritative `SelectionState`/`PassengerDraft` only |
| Freshness / stale protections | `ResultRef.freshness` ("fresh"/"stale"/"unknown"), `supersededBy` bookkeeping in store |
| Test commands | `npx vitest run`, `npx playwright test`, `npx tsc --noEmit`, `npm run lint`, `npx next build` |

Baseline gates at `37bf34e`: 277 unit passed / 6 env-skipped; 195 e2e; tsc/lint/build clean. No pre-existing failures.

## 2. Missing capabilities added (additive only)

1. **`src/assistant/booking/preparation.ts` (NEW) — BookingPreparationService.** Pure, deterministic `evaluateReadiness(conv)` over authoritative state → `{ ready, missingFields, blockers, warnings }`. Blockers: `NO_TRAIN_SELECTED`, `NO_CLASS_SELECTED`, `CLASS_NOT_OFFERED`, `NO_JOURNEY_DATE`, `NO_PASSENGERS`, `PASSENGER_INCOMPLETE`, `STALE_AVAILABILITY`, `STALE_FARE`. Warnings: `AVAILABILITY_NOT_VERIFIED`, `FARE_NOT_VERIFIED` (absence never blocks — nothing invented), `BERTH_IS_REQUEST_ONLY`. Stale = existing `freshness === "stale"` or `supersededBy` on the latest matching `CHECK_AVAILABILITY`/`GET_FARE` ref. The LLM is never the readiness authority.
2. **Review/confirmation boundary in `store.ts`** — `ReviewState { version, builtAt, status: awaiting_confirmation|confirmed, snapshot }`; `buildReview` (only when readiness.ready), `confirmReview` (only when a review exists, is awaiting, and `reviewSnapshot(conv)` still matches — otherwise invalidated). `IRCTC_HANDOFF_READY` exported constant; `confirmed` is the terminal preparation state and nothing else (no booking call exists anywhere). Every booking-critical mutation (`setSelection`, `setSelectionClass`, `clearSelection`, `updatePassenger`, `addPassenger`, new `SEARCH_TRAINS`/`CHECK_AVAILABILITY`/`GET_FARE` results) clears the review, so a previous confirmation never authorizes changed details.
3. **Owner rule — every passenger-form field is mandatory:** `REQUIRED_PASSENGER_FIELDS` now `["name","age","gender","berth"]`. Berth remains a *request-only* value (no provider verifies it) but is required before review; UI label changed from "(optional)" to mandatory-with-honest-note; context block `MISSING:` list, per-passenger completeness, add-passenger gating and review readiness all derive from the same constant.
4. **`/api/passenger` actions `review` + `confirm`** (same validated endpoint; responses now carry `readiness` + `review`). Confirmation is an explicit validated action — chat text "haan/yes/confirm" is deliberately NOT keyword-routed to confirmation (P31 §2 forbids keyword intent routing); the authoritative state alone gates it.
5. **SSE `passenger_form` event** now carries `readiness` + `review` (additive payload); `ChatClient`/`PassengerFormPanel` render them: blocked line (exact missing fields), `review-ready`, `build-review`, `review-awaiting` + `confirm-review`, and the `handoff-ready` banner ("IRCTC_HANDOFF_READY — booking details ready for handoff. Actual booking execution is not enabled.").

No new tool definitions, no schema/description changes, no model/provider/prompt changes, no second state machine, no duplicate form, no voice-specific path (voice = same SSE + same store).

## 3. Files changed and rationale

| File | Change |
|---|---|
| `src/assistant/booking/preparation.ts` | NEW — deterministic readiness service (see §2.1) |
| `src/assistant/context/store.ts` | `berth` added to required fields; `ReviewState`; review invalidation on all critical mutations; `buildReview`/`confirmReview`/`reviewSnapshot` |
| `src/app/api/passenger/route.ts` | `review`/`confirm` actions; `readiness`/`review` in responses |
| `src/assistant/orchestrator.ts` | `passenger_form` event payload += `readiness`, `review` (type-only + two fields) |
| `src/components/ChatClient.tsx` | carries `readiness`/`review` into form state |
| `src/components/PassengerFormPanel.tsx` | berth mandatory UI + error/next-field markers; readiness/review/confirm/handoff section |
| `tests/unit/p31-preparation.test.ts` | NEW — 12 deterministic tests (readiness, stale blocking, invalidation, confirmation safety, route boundary, no-booking assertion) |
| `tests/unit/p27-diagnosis.test.ts` | context `MISSING:` now includes `berth` (same rigor, new owner rule) |
| `tests/e2e/passenger-form.spec.ts` | berth-mandatory review gating + review→confirm→handoff UI flow (fixture-labelled) |
| `docs/prompt31-...-report.md` | this report |

## 4. Regression coverage (P31 §12 items 1–22)

| # | Coverage | Result |
|---|---|---|
| 1–2 | readiness complete/incomplete; missing count/train/class | p31 tests 1–2 |
| 3 | valid + ambiguous class/train selection | p31 test 3 + existing p30-journey/P25 suites |
| 4 | class vs authoritative classes | p31 test 3 (`CLASS_NOT_OFFERED`) |
| 5–6 | form opens after valid selection; autofill from authoritative state | passenger-form e2e (5 viewports) |
| 7–8 | multi-passenger; multi-field extraction validated | store gating tests + p27 suite |
| 9–10 | corrections/count changes; invalid data rejected | p31 tests 9, 5 + existing |
| 11 | age-only recovery stays age-only | P29 suites re-run green (288→289 unit) |
| 12–13 | stale availability/fare block; journey change invalidates | p31 tests 6, 9, 10 |
| 14–15 | deterministic review; invalidation after critical change | p31 tests 7, 9, 12 |
| 16–17 | confirm rejected outside awaiting / against stale review | p31 tests 8, 9, 12 |
| 18 | preparation-only transition to handoff-ready | p31 test 11 + e2e handoff test |
| 19 | provider failure ≠ fabricated facts | existing provider-failure suites re-run |
| 20 | text+voice one pipeline, no duplicate emission | P28 J + unchanged orchestrator |
| 21 | no booking/payment/OTP/CAPTCHA execution | p31 test 11 asserts no book/pay/submit capability; no booking route exists |
| 22 | general Q&A / unrelated tools unchanged | full unit suite green; zero diff to tools/prompts |

## 5. Gate results vs baseline (37bf34e: 277 unit / 195 e2e)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors / 0 warnings |
| `npx next build` | clean |
| `npx vitest run` | **289 passed / 6 skipped** (277 + 12 new; skips = intended env-gated live-verify; one extra skip observed pre-build was the client-bundle scan awaiting `.next`, activated after build) |
| `npx playwright test` | **200/200** (195 + 5 new review/confirm e2e × viewports) |

Environment notes (not code failures): sandbox reset had wiped `node_modules`, Playwright browsers and OS libs — restored via `npm install`, `npx playwright install chromium`, `npx playwright install-deps chromium`; a mid-run "195 failed" was the missing-browser condition (health spec passed then because it uses no browser), resolved by the installs above. No assertion weakened anywhere; mocked/unit tests are labelled as such and live verification remains in the env-gated `live-verify` file + `scripts/live-*.mjs`.

## 6. Confirmations

- **AI behaviour unchanged:** zero diff to model/provider settings, prompts, tool definitions/schemas/descriptions, tool_choice, dispatcher, orchestrator decision loop. Only additive SSE payload fields.
- **Prompt 28/29 recovery remains age-only:** no diff to guard/recovery; P29 suites green; berth becoming *required for review* does not touch the recovery eligibility (still: blocked **age** claim + form open + age authoritatively missing + single shot).
- **Booking/payment disabled:** no booking endpoint/provider/code path exists; `IRCTC_HANDOFF_READY` explicitly reports "actual booking execution is not enabled"; no fake PNR possible.
- **Sensitive data:** no new passenger fields beyond the existing contract; validators unchanged; passenger values never logged (route/store log nothing but safe metadata).

## 7. Limitations / remaining blockers

- Confirmation is an explicit validated UI action (`/api/passenger action=confirm`); conversational "haan" is intentionally not interpreted as confirmation (keyword routing forbidden by §2). If a conversational confirm is later wanted, it must come via a new owner-approved LLM tool, not phrase-matching.
- Availability/fare absence is a warning, not a blocker (preparation never invents data); staleness of recorded data blocks review.
- No push/deploy performed; commit is local and scoped to this milestone only.
