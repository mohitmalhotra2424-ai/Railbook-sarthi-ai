# Prompt 25 — Acceptance Report
## Conversational Train Selection, Verified Passenger Form & Hands-Free Autofill

Date: 2026-10-11 · Scope: `railsaarthi-ai/` · Baseline: commit `361cd96` (P23, local)

> **This milestone is data collection and review only. Booking, payment, IRCTC auth, OTP and CAPTCHA remain disabled. Nothing in this change can place an order or produce a PNR.**

---

## A. Baseline

| Item | Value |
|---|---|
| Starting HEAD | `361cd96` — "P23: acceptance audit" (local only; `origin/main` = `7c396c5` = Render LIVE) |
| P22–P24 pass status | **Not assumed.** P25 was implemented against the actual tree at `361cd96`; no prior report was trusted as green. |
| Existing architecture inspected before changes | `src/assistant/` orchestrator + ConversationStore + tool executor; `ChatClient` SSE consumption; `TrainResultCards`; existing passenger schema had **no** prior selection/form-autofill machinery. |
| Approach | Additive only: 3 new application-action tools, 1 new validation module, 1 API route, 1 UI panel. **No keyword router, no second state machine, no duplicate form.** Existing tools, AI loop and provider logic unchanged. |

Files added: `src/assistant/passengers/validate.ts`, `src/app/api/passenger/route.ts`, `src/components/PassengerFormPanel.tsx`, `tests/unit/passenger-selection.test.ts`, `tests/e2e/passenger-form.spec.ts`, `scripts/live-selection.mjs`.
Files modified: `src/assistant/context/store.ts`, `src/assistant/tools/schemas.ts`, `src/assistant/tools/executor.ts`, `src/assistant/orchestrator.ts`, `src/assistant/prompts.ts`, `src/components/ChatClient.tsx`, `src/components/TrainResultCards.tsx`, `tests/unit/orchestrator.test.ts` (tool-count assertion 9 → 12, factual update).

---

## B. Train / Class Selection

**Design:** the LLM never writes to state directly. It proposes `SELECT_TRAIN {trainNumber}` / `SELECT_CLASS {classCode}`; the backend resolves the proposal against the **current, non-superseded search results** (trains) and **provider class data for the selected train/date** (classes). Only on success does `ConversationStore` mutate and a `passenger_form` SSE event reach the UI. The UI "Selected" badge and form open derive solely from that validated event.

Verified behaviours (unit, `tests/unit/passenger-selection.test.ts`):

| Requirement | Evidence |
|---|---|
| Selecting a train present in current results updates real state and emits the UI event | Test 1 PASS |
| Selecting a train **absent** from current results is rejected; state untouched; honest message | Test 2 PASS |
| Class unsupported for the selected train is rejected with an honest distinction (exists vs eligible vs available vs unsupported); supported class opens the passenger form | Test 3 PASS |
| Duplicate/repeat of an identical selection call does not duplicate actions (idempotent, duplicate-suppressed) | Covered by orchestrator duplicate-suppression + Test 1/3 re-selection assertions |
| Changing journey date supersedes the search and **clears** selection + passenger state | Test 6 PASS |
| LLM class lists are never authoritative — validation uses provider data only | Test 3 asserts rejection of a plausible-but-unsupported class |

---

## C. Passenger Autofill

**Design:** after a valid train + class the `passenger_form` event opens the existing passenger form automatically (no invalid opens). The LLM collects **one missing field at a time** from the actual schema (`name`, `age`, `gender`, `berth`) via `UPDATE_PASSENGER {passengerIndex, field, value}`. The backend validates before commit; invalid values never overwrite valid data; corrections overwrite the same field in place; multi-passenger entries are tracked independently; a new passenger may only be started when the current one is complete (store guard). The same validated path serves chat and voice — voice transcripts pass through the same orchestrator and tools; there is exactly one state machine.

| Requirement | Evidence |
|---|---|
| One field at a time, from the actual schema; never invents fields | Unit Test 4 PASS (unknown field rejected: "Unknown passenger field") |
| Validate before commit; invalid value rejected, valid data retained | Unit Test 4 PASS (age 280 rejected, then 28 committed) |
| Correction overwrites the same field, no duplication | Unit Test 4 PASS |
| Out-of-order passenger index blocked while current passenger incomplete | Unit Test 4 PASS (store guard) |
| Immediate form update via `passenger_form` event / `/api/passenger` response | Unit Test 4 + e2e PASS |
| New chat does not leak passenger state | e2e Test 2 PASS |
| Invalid values can't overwrite valid; late responses can't clobber newer state | Validated path is synchronous per store; e2e asserts final form content after interleaved invalid/valid submits |
| Manual edit remains available as fallback | e2e Test 1: manual edit goes through the same validated `/api/passenger` route |

---

## D. Verified Options

| Option | Decision | Basis |
|---|---|---|
| Berth preference | **Supported as a request only**, explicitly labelled "requested — not guaranteed"; no provider guarantees berths in this integration | Unit Test 5 PASS |
| Food preference (veg/non-veg/Jain) | **Omitted entirely.** No authorised source supports it, so the field does not exist and is never offered; asking for it gets an honest refusal, nothing invented | Unit Test 5 + e2e (no food field in DOM) + live L7 PASS |
| Class availability/eligibility vs existence | Distinguished honestly in rejection messages; LLM class lists ignored | Unit Test 3 PASS |
| Provider timestamp | Existing string preserved verbatim: "Provider timestamp unavailable — freshness cannot be verified." when a provider returns no timestamp | Unchanged from P23; re-asserted in existing e2e suite |
| "IRCTC verified" claims | Never produced — no such label exists in this product | Code inspection: no such string added |

---

## E. Test Evidence

### Automated (all green)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Unit | `npx vitest run` | **227 passed**, 6 skipped (30 files pass, 1 skipped) — includes 6 new passenger/selection tests |
| Build | `npx next build` | clean |
| E2E | `npx playwright test` (4 viewports: 360×800, 390×844, 412×915, 1280×900) | **190/190 passed** (180 prior + 2 new passenger-form tests × 5 projects) |

New E2E tests are **mock-based and labelled as such**: they drive the app with a fixture SSE stream (including the `passenger_form` event) and intercept `/api/passenger`; they verify UI behaviour (auto-open, next-field indicator, error surfacing for age 280, valid-path update, New-Chat isolation). The 20-test Phase-10 checklist is covered by these mocks plus the unit tests and the live check below; every mock test file states in its header that it uses fixtures.

### Live check (real LLM + real providers, clearly distinguished from mocks)

`scripts/live-selection.mjs` against a production build (`next start`, providers `confirmtkt-v1,erail-v1,web-data-v1`, NVIDIA LLM). **Final run: 5/7.**

| # | Check | Result |
|---|---|---|
| L1 | Live search returns real trains (train 11906) | PASS |
| L2 | Chat selection updates real state (`sel=11906`) | PASS |
| L3 | Class 2A validated against provider classes (supported: 2A,3A,3E,SL) → form opened | PASS |
| L4 | Name collected, validated, committed to form | PASS |
| L5 | Age collected next, name retained | **FAIL** — see below |
| L6 | Natural correction overwrites the same field | **FAIL (cascade)** — name correction worked (`UPDATE_PASSENGER:ok`, Rohit Sharma committed) but age was missing because L5 never recorded it |
| L7 | Food unsupported → honestly refused, nothing invented | PASS |

**L5/L6 root cause (honest classification):** the model (`meta/muse-glimmer-30b` via NVIDIA) intermittently **replied "Age 28 save ho gaya" without calling `UPDATE_PASSENGER`** (server log for that turn: `toolResults: 0`). The prompt was hardened twice (explicit "ALWAYS call UPDATE_PASSENGER" rule, plus an absolute GROUNDING rule forbidding save claims without a matching ok tool result in the same turn); across 4 live passes the model complied for name/correction/food but repeated the false save claim for the bare "Age 28." turn. **The backend invariant held in every pass:** state and UI only ever change on a validated tool success — the form never showed the phantom age, and no fabricated data entered the session. This is a residual model-compliance defect, not a state-integrity defect; it is reported as FAIL rather than being re-run until it passes.

---

## F. Final Status

**PARTIAL PASS**

- **PASS:** train/class selection against real data with honest rejection; automated form opening after valid selection; one-field-at-a-time collection with validation, corrections, passenger isolation and date-supersede clearing; berth as unverified request; food omitted; single state machine for chat + voice; new-chat isolation; manual-edit fallback; all five automated gates green (tsc, lint, 227 unit, build, 190 e2e).
- **FAIL (live, residual):** L5/L6 — the LLM intermittently claims a passenger detail was saved without calling the tool. Application state remains truthful in all observed cases; the false claim exists only in chat text. Mitigations applied: prompt hardened twice; UI form independently shows true missing-field state so the user sees the truth even when the text lies. Follow-up options (require approval, not taken): a different/stronger model for this flow, or a UI-visible "not saved" reconciliation hint.
- **Constraints honoured:** no push, no deploy, no production restart; changes are local commits only; existing tools/AI logic untouched; no duplicate forms or parallel architecture; P22–P24 not assumed passed; nothing in this milestone enables booking, payment, or ticket/PNR issuance.

**Classification: this milestone delivered data collection and review capability only. No booking is enabled anywhere in the product.**
