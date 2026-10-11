# Prompt 28 — Intelligent Tool-Call Safety Net & Bounded Recovery
## Report

Date: 2026-10-11 · Scope: `railsaarthi-ai/` · Baseline: `main` @ `4b4fbea` (P27 diagnosis), working tree clean at start.

> Reliability fix only. Booking, payment, cancellation execution, ticket issuance, IRCTC login, OTP and CAPTCHA remain disabled. No push, deploy, or production change.

---

## 1. Files changed and why

| File | Change |
|---|---|
| `src/assistant/orchestrator.ts` | The only production change. Three additive edits: (1) per-turn recovery state (`recoveryUsed`, `recoveryFallback`); (2) in the direct-answer branch, after the existing P26 guard runs, a strictly-once recovery trigger that appends the model's own text + a `RECOVERY:` system correction message and re-enters the **same** loop (`continue`) — so any resulting tool call flows through the existing validation, dispatch, result-handling, `passenger_form` event and response path untouched; (3) if the recovery LLM request itself fails (timeout/error/no endpoint), the stored honest P26 fallback is delivered instead of a raw error — never a false claim. Also imports `REQUIRED_PASSENGER_FIELDS` (existing export) for the missing-field check. |
| `tests/unit/p28-recovery.test.ts` | NEW — deterministic Tests A–K (recording/scripted LLM doubles, fixture provider; clearly mocked, no live calls). |

No other file touched. No keyword router, second agent, duplicate orchestrator, scripted engine, or new state store. Guard module, tool schemas, prompts, model config, `tool_choice`, parser, dispatcher, duplicate-call guard, iteration cap, validation pipeline: all unchanged.

## 2. Trigger conditions and evidence requirements

Recovery fires only when **all** hold, evaluated at the exact point the P26 guard runs:

1. The P26 guard blocked an unsupported passenger-field save claim **this turn** (`guarded.adjusted` with `blockedClaims`).
2. The claimed field is still MISSING in the authoritative current-session state (`ConversationStore` snapshot: `REQUIRED_PASSENGER_FIELDS` missing on the current passenger; `details` claims require any missing field).
3. The validated context supports a legitimate update (train + class selected, i.e. form open).
4. `!recoveryUsed` and the existing `MAX_TOOL_ITERATIONS` budget remains.

Evidence is the guard's own — structured tool results + authoritative state only; never the user's or model's wording. Normal questions, acknowledgements, and tool-less turns that make no save claim never trigger recovery (Test A/K).

## 3. One-request proof

- `recoveryUsed` is set **before** the recovery request and never reset within a turn; the trigger is unreachable a second time (Test H: repeated blocked claims → exactly 2 LLM requests).
- Recovery re-enters the same bounded loop — `MAX_TOOL_ITERATIONS` (6) still caps total steps (existing `orchestrator-loop-cap` suite still passes).
- Recovery failure paths stop immediately: second plain text → P26 fallback delivered (Test E); timeout/error → P26 fallback delivered, no error bubble, no third request (Test F).
- Duplicate identical tool calls during recovery are suppressed by the pre-existing `executedCalls` guard — one execution only (Test I).
- Live evidence (single smoke run): server log shows exactly one `save-claim recovery: one bounded re-ask` for the affected turn.

## 4. Tests and actual outcomes

Deterministic suite `tests/unit/p28-recovery.test.ts` — **11/11 PASS** (all mocked doubles):

| Test | Result |
|---|---|
| A normal conversation → no recovery (1 request) | PASS |
| B unsupported claim + missing field → exactly ONE extra request carrying the `RECOVERY:` instruction | PASS |
| C recovery tool call → existing pipeline: `UPDATE_PASSENGER:ok`, state updated, `passenger_form` emitted, truthful confirmation delivered verbatim | PASS |
| D invalid value (280) in recovery call → `invalid_arguments`, form unchanged | PASS |
| E recovery returns plain text again → honest fallback, exactly 2 requests, no third | PASS |
| F recovery timeout → honest fallback delivered (no error event, no false claim, no state change) | PASS |
| G already-saved field → guard allows truthful confirmation, zero recovery | PASS |
| H repeated guard evaluation → recovery fired once (2 requests total) | PASS |
| I duplicate tool call during recovery suppressed (one `ok` result, saved once) | PASS |
| J recovery turn emits exactly ONE `message` event (text + voice share it) | PASS |
| K railway Q&A, name correction, class answers → byte-identical behaviour, no recovery | PASS |

Gate results vs verified baseline (P27: 248 unit / 190 e2e):

| Check | Baseline | Now |
|---|---|---|
| `npx vitest run` | 248 passed | **259 passed** (248 + 11 new, 0 regressions), 6 skipped |
| `npx playwright test` (4 viewports) | 190/190 | **190/190** |
| `npx tsc --noEmit` | clean | clean |
| `npm run lint` | 0 problems | 0 problems |
| `npx next build` | clean | clean |

No pre-existing failures were observed at baseline or after; nothing to attribute separately.

### Live smoke test (ONE bounded run, clearly distinguished from mocks)

`scripts/live-selection.mjs`, real LLM + providers. Server log for the affected turn (`t-8989a01c`) shows the full designed sequence:

1. `finishReason:stop, toolCallCount:0` — the P27 omission reproduced (7th occurrence).
2. `save-claim guard replaced an unsupported confirmation {blockedFields:["age"]}` — P26 guard fired.
3. `save-claim recovery: one bounded re-ask {fields:["age"]}` — **recovery fired exactly once**.
4. `finishReason:tool_calls, toolCallCount:1` — **the model called `UPDATE_PASSENGER` in response to the re-ask** — the first time in 7 live runs that this turn produced a tool call.
5. The call carried `{"passenger":1,"field":"age","value":28}` — `value` as a JSON **number**, which the existing strict tool-argument schema (`value: string`) correctly rejected as `invalid_arguments`. A duplicate retry was suppressed. The model then honestly asked the user to repeat the age. L5G PASS: no unsupported save claim reached the user; form state untouched.

Result: 6/8 script checks (L5/L6 fail solely on the arg-typing rejection below). **The recovery mechanism itself performed exactly as specified**: one re-ask, real tool call, honest outcome, no fabricated success.

## 5. Unresolved issues

1. **Model emits numeric `value` for age** (`"value":28` vs schema `"type":"string"`) → existing strict validation rejects it. This is a newly-surfaced, distinct defect (arg typing, not omission). Fixing it requires touching the tool schema or the argument parser (e.g. accept `string|number`, or coerce numbers to strings before validation — `validateAge` already accepts both) — **explicitly out of P28 scope** ("do not change existing tool definitions, schemas, descriptions, parser"). Flagged for separate approval; until then the user is honestly asked to repeat and a re-typed "28" string is accepted (existing behaviour).
2. Recovery adds one extra LLM call (~30–90 s worst case observed live) on affected turns only; bounded and only after a proven defect.
3. The model may still omit the call even after recovery — the honest P26 fallback covers that case permanently (Test E).

## 6. Non-change confirmation

AI logic/understanding/personality, system prompt, tool descriptions, model/provider/settings, `tool_choice:"auto"`, parser, dispatcher, tool-selection behaviour, passenger-form/session architecture, state ownership, P26 guard evidence requirements and honest fallback: **all unchanged** (verified by zero diffs outside the two files above, the full 259-test unit suite including the P26 guard and P27 diagnosis suites, and 190/190 e2e). No production configuration or service touched; nothing pushed or deployed. Prompt 29 not started.
