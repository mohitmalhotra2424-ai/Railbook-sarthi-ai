# Prompt 26 — Verified Save-Claim Guard & Honest Passenger-Form Confirmation
## Report

Date: 2026-10-11 · Scope: `railsaarthi-ai/` · Baseline: commit `bd386f5` (P25, local)

> This milestone addresses response correctness and passenger-form data integrity only. Real ticket booking, payment execution, IRCTC login, OTP, CAPTCHA and ticket issuance remain disabled. No deployment, push, or production change was made.

---

## 1. Root cause and exact reproduction

**Root cause (from Prompt 25):** the configured LLM (`meta/muse-glimmer-30b` via NVIDIA) intermittently produces a final text like *"Age 28 save ho gaya"* / *"उम्र 28 सेव हो गई है"* **without issuing the `UPDATE_PASSENGER` tool call** (server log for those turns: `toolResults: 0`). The backend never saved anything — the passenger form is only mutated through the validated tool path — but the chat text (and therefore the spoken answer, which consumes the same message) asserted a save that never happened. Prompt 25 mitigated this with prompt hardening only; across 4 live passes the model still recurred on the bare "Age 28." turn.

**Exact reproduction (live, 2026-10-11, P26 verification run):** conversation turn `t-d7bea162-…`, user said "Age 28.", turn completed with `toolResults: 0` — the same signature as the P25 residual failure.

## 2. Files changed and why

| File | Change | Necessity |
|---|---|---|
| `src/assistant/passengers/save-claim-guard.ts` | **NEW** — pure function `guardSaveClaims({text, turnResults, passengers})`: detects passenger-field save claims (English/Hinglish/Hindi) in the final text and permits them only when authoritative evidence supports them; otherwise replaces only the unsupported sentence with a language-matched honest fallback. | The narrow post-response consistency guard. Pure: it executes no tools, changes no arguments, mutates no state, and makes no second LLM call. |
| `src/assistant/orchestrator.ts` | At the single point where the final assistant text is persisted and emitted (`message` event), the text now passes through `guardSaveClaims` with this turn's `turnResults` and the current conversation's authoritative `passengers` snapshot; corrected text is persisted and delivered; a structured warning is logged (no passenger data). | One hook point covers text AND voice — ChatClient renders the bubble and speaks TTS from this same `message` event. No pipeline duplication. |
| `tests/unit/save-claim-guard.test.ts` | **NEW** — Tests A–J. | Required regression coverage. |
| `scripts/live-selection.mjs` | Added check **L5G**: when no successful `UPDATE_PASSENGER` recorded the age this turn, the delivered text must not claim a save. | Records guard behaviour in the bounded live reproduction without weakening the existing L5 state check. |

Nothing else changed. No second engine, no keyword intent router, no duplicate form/state/architecture.

## 3. How the guard uses existing authoritative evidence

Claim detection is scoped to **passenger fields** (name/age/gender/berth/details) combined with a save/update/confirm verb + completion marker in English, Hinglish or Devanagari. A detected claim is permitted only if the **current session's authoritative passenger-form state** (the same `ConversationStore` snapshot the form UI renders) contains the claimed field — and, when the claim states a concrete value, the exactly matching value (age must equal the claimed number; a mentioned name must match the stored name). A successful `UPDATE_PASSENGER` result **from this turn** whose post-update passenger array supports the claim is the fresh-evidence path.

Mapping to the required conditions:
1. **Unambiguous field/passenger** — claim must name a known passenger field; value-specific claims must match a stored value.
2. **Passed backend validation** — only values that passed `validatePassengerField` can exist in authoritative state or in an "ok" tool result's `data.passengers`; the guard never reads raw model text as evidence.
3. **Actual successful result or authoritative state-update** — this-turn `UPDATE_PASSENGER status:"ok"` result, or the authoritative state itself (recorded via a previously validated update through the same single path).
4. **State contains expected validated value** — the state check is mandatory in every permitted case.
5. **Not stale / not cross-session** — the guard receives only the current turn's result array and the current conversation's snapshot; earlier turns' results and other sessions' successes are structurally invisible to it, and superseded state (date change clears passengers) correctly withdraws support (Test F).

When evidence is missing, failed, mismatched, or stale, the unsupported sentence is replaced by e.g. *"Age abhi save confirm nahi hui. Please form mein check kar lein."* (or the Devanagari equivalent), and the rest of the response is preserved. Truthful confirmations backed by an existing verified value are **not** blocked (Test G).

## 4. Results for Tests A–J (`tests/unit/save-claim-guard.test.ts` — 10/10 PASS)

| Test | Scenario | Result |
|---|---|---|
| A | Exact residual failure: model says "Age 28 save ho gaya" with `toolResults: 0` → delivered text contains the honest fallback, not the claim; form unchanged (`{name:"Rahul Sharma"}`, no age); corrected text is what's persisted | **PASS** |
| B | Genuine success (`UPDATE_PASSENGER:ok`, state age 28) → "Age 28 save ho gaya." delivered verbatim | **PASS** |
| C | Tool returned `invalid_arguments` but model claims saved → blocked | **PASS** |
| D | No matching result / no state value → blocked (Hinglish and Devanagari variants) | **PASS** |
| E | Mismatches: claimed age 28 vs stored 30; claimed name "Priya" vs stored "Rahul Sharma"; berth saved but age claimed → all blocked | **PASS** |
| F | Stale/cross-session: age 28 saved, then date change supersedes (state cleared), other session succeeds — re-claim in original session blocked | **PASS** |
| G | State already contains age 28 from a verified earlier update, no tool this turn → confirmation NOT called unsaved, text untouched | **PASS** |
| H | Normal railway answers and passenger questions (incl. "Train select ho gayi…") pass through byte-identical | **PASS** |
| I | Voice/text parity: exactly one guarded `message` event feeds both the text bubble and conversation-mode TTS; neither announces an unsupported save | **PASS** |
| J | Tool definitions unchanged (same 12 names, same order); invalid age 280 still rejected `invalid_arguments` through the existing validation path; honest non-claim text untouched | **PASS** |

## 5. Regression, type-check, lint, build

| Check | Result |
|---|---|
| `npx vitest run` (all unit) | **237 passed**, 6 skipped (31 files pass) — includes all Prompt 25 passenger/selection tests |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 0 warnings |
| `npx next build` | clean |
| `npx playwright test` (4 viewports) | **190/190 passed** |

## 6. Bounded live reproduction

One live run only (`scripts/live-selection.mjs`, real LLM + providers, no rerun chasing): **6/8** checks.

- The model **reproduced the original failure** on L5 (replied to "Age 28." without calling the tool; turn `toolResults: 0`).
- **The guard blocked it**: delivered text was *"Age abhi save confirm nahi hui. Please form mein check kar lein. Ab gender batao — Male / Female / Trans."* Server log: `save-claim guard replaced an unsupported confirmation {"blockedFields":["age"]}` — logged fields only, no passenger data, no keys.
- **L5G PASS** (`ageSaved=false claimsSaved=false`). L5/L6 remain FAIL exactly as in P25 — the underlying model tool-calling omission is out of P26 scope (AI tool-calling behaviour must not be changed); what changed is that the user can no longer be told something was saved when it wasn't.
- L1–L4, L7 pass as before.

## 7. Remaining limitations

- The model may still fail to call `UPDATE_PASSENGER` for a supplied detail (P25 residual). The user now receives an honest "not confirmed — check the form" instead of a false confirmation, and the form's own missing-field indicator stays truthful.
- Claim detection is pattern-based over the final text (verbs × completion markers × field tokens). An exotic phrasing of a save claim could slip through detection; every observed real-world phrasing (English/Hinglish/Devanagari, from 6 live passes) is covered.
- Name-mismatch detection compares capitalized name phrases against stored names; an all-lowercase mismatched name mention ("rohit ka naam save ho gaya" while "Rahul" is stored) would not be caught by the mention check — but the claim still requires the authoritative state to hold a saved name (no fabricated value can ever be confirmed).

## 8. Explicit non-change confirmation

- **Model/provider/config:** unchanged (still `meta/muse-glimmer-30b` via NVIDIA, same fallback config).
- **AI understanding / system prompt / conversational behaviour:** unchanged (no prompt edits in P26).
- **Tool definitions, schemas, selection, calling, execution order, orchestration loop:** unchanged (Test J asserts the identical 12-tool list and order).
- **Passenger-form architecture and booking state:** unchanged — form still mutates only via `validatePassengerField` → `ConversationStore.updatePassenger`; booking/payment/IRCTC/OTP/CAPTCHA remain disabled.
- **Voice/text flows:** unchanged except that both consume the guarded `message` event (the safeguard the prompt requires for both).
- **No deployment, no GitHub push, no production configuration change, no production restart.** Local commit only.

## FINAL STATUS: **PASS**
