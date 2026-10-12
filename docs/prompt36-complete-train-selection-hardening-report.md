# Prompt 36 — Complete Train Selection Hardening Report

## 1. Verified starting state (inspected, not assumed)
- Worktree at `f068a87`, clean except pre-existing untracked `scripts/` artifacts.
- Baseline re-verified from the actual repo: `tsc --noEmit` clean; full unit run passed.
  The sandbox had reset since the commit, so `.next` was gone — that made the
  build-gated `client-bundle` secret-scan skip (338 passed/7 skipped pre-build vs the
  reported 339/6). After `next build`, the scan re-activated: **348 passed / 6 skipped**
  (the 6 are the `LIVE=1`-gated live-verify suite). Playwright browsers + OS libs were
  also wiped by the reset and reinstalled before the E2E run.
- Prompt 35 report claims confirmed in code: full authoritative `ResultRef.items`
  (no cap), LLM render capped at 8 with `+N more` marker, full-token number matching,
  date/route supersede protections.

## 2. Root cause of remaining gaps (from actual code)
- `SelectTrainArgs` accepted ONLY `trainNumber` — name- or position-based requests could
  not be expressed by the model, so trains beyond the 8 visible summaries were reachable
  only when the user happened to state the number.
- `executor.ts` matched only `trainNumber` against `ref.items`.
- `store.ts` superseded older `SEARCH_TRAINS` refs only on date/route change — a
  **same-route/date refresh** left two "current" result versions, so a stale list stayed
  selectable and a pending selection could survive into the new version (result-version
  gap, Prompt 36 §4).

## 3. Files changed and why
| File | Change |
|---|---|
| `src/assistant/tools/schemas.ts` | `SelectTrainArgs` extended with **optional** `trainNumber` (existing 4–6-digit, trim/number-tolerant), `trainName` (verbatim user text, 2–120 chars) and `resultPosition` (integer ≥1), plus a refine requiring at least one identity. Model-facing `SELECT_TRAIN` tool definition updated: description explains pass-through of the user's stated identity and backend resolution against the FULL current results; `required: []` keeps number-only calls valid (backward compatible). No second tool, no redundant fields. |
| `src/assistant/tools/executor.ts` | `SELECT_TRAIN` resolution rewritten: **number** = exact full-token match (never prefix/substring/fuzzy); **name** = conservative normalization (case, repeated whitespace, common punctuation) against the full current results, exact match preferred over substring, unique match required — duplicates/similar names return a clarification error naming up to 4 candidates and asking for the train NUMBER; **position** = 1-based against the NEWEST current result list (same numbering as UI cards and numbered context items); supplied identities must all resolve to the SAME train — conflicts reject with a clarification, never a silent preference. Selection identity is written from the **result row** (authoritative), not from the LLM's echo. |
| `src/assistant/context/store.ts` | A newer `SEARCH_TRAINS` for the same route+date now supersedes the older ref (`"newer search for the same route/date"`) and clears pending selection/passengers — stale result versions can no longer stay selectable or leak into a refreshed session. |
| `tests/unit/selection-full-results.test.ts` | Rewritten: 22 deterministic tests on a 120-row fixture (final position 120 included). |
| `scripts/p36-live-selection-verify.py` | New: live end-to-end verification script (real model + real provider) used for the evidence in §5. |

Unchanged: AI model/provider + fallback, system prompts, reasoning strategy, general
tool-calling behaviour, other tool schemas, provider integrations/credentials, booking
preparation/review safeguards, payment/IRCTC/OTP/CAPTCHA, UI design (no UI edit was
needed — the card class-chip already transmits the card's authoritative train number),
session logic, production configuration. No dependencies added; no credentials or
passenger data logged.

## 4. Final SELECT_TRAIN contract and resolution rules
```
SELECT_TRAIN { trainNumber?: "4-6 digit exact number", trainName?: "name verbatim from user",
               resultPosition?: integer ≥ 1 }   // at least one required
```
- Resolve against full authoritative results of the active non-superseded
  `SEARCH_TRAINS` refs (newest first). Number: full-token equality only. Name:
  normalized (case/whitespace/punctuation) unique match, exact-over-substring, else
  clarification. Position: 1-based on the newest current list = UI card numbering.
- All supplied identities must agree on one train; conflicts and ambiguity reject with
  short actionable errors (ask for the train number / explain not-in-results).
- Success writes the authoritative identity from the result row; failure selects nothing.
- Number-only calls behave exactly as before (compatibility preserved).

## 5. Evidence: real end-to-end flow (real model, real provider, production build)
Local production build (`next start`) + `muse-glimmer-30b` + confirmtkt provider,
LDH→NDLS 2026-10-12 — 31 rows; position 25 = **12030 SWARN SHATABDI** (the original bug):
- **Position:** “25th train select karo” → model emitted
  `SELECT_TRAIN({"trainNumber":12030,"resultPosition":25})` → ok → selection
  `{trainNumber:"12030", trainName:"SWARN SHATABDI", journeyDate:"2026-10-12"}` — matches
  card #25. (Had the echoed number disagreed with the position, the conflict rule would
  have rejected.)
- **Name (fresh conversation):** “ASR KIR EXPRESS select karni hai” (position 15, beyond
  the visible 8) → `SELECT_TRAIN({"trainNumber":15708,"trainName":"ASR KIR EXPRESS"})` →
  ok → selection 15708 ASR KIR EXPRESS — matches card #15; honest confirmation reply.
- **Number:** “12030 select karo” → `SELECT_TRAIN({"trainNumber":12030})` → ok → 12030.
One observation: in a conversation where the train was already selected, a by-name repeat
prompt got a direct textual answer with no tool call (model judged it redundant) — no
wrong selection occurred.

## 6. Test results (exact commands)
- Focused suite: `npx vitest run tests/unit/selection-full-results.test.ts` → **22 passed**
- Full unit: `npx vitest run` → **348 passed, 6 skipped** (6 = LIVE-gated live-verify)
- Typecheck: `npx tsc --noEmit` → clean
- Lint: `npm run lint` → only the 2 pre-existing errors in `src/app/review/page.tsx`
  (untouched; no new issues introduced)
- Build: `npx next build` → ✓ compiled successfully
- E2E: `npx playwright test` → **245 passed** (UI, chat/voice tool flow, stale-session)

### Focused-suite coverage (fixture: 120 rows, final position 120)
- Identity/number: positions 3, 8 ✓; 9, 25, 40, 100, 120 (final) ✓; whitespace `" 90025 "`
  and JSON-number `90040` ✓; 4-digit `9000` never prefix-selects ✓
- Identity/name: normalized case/whitespace/punctuation ✓; unique name + exact-over-
  substring preference ✓; duplicate names → clarification “matches 2 trains”, nothing
  selected ✓; number+name same train ✓; number+name conflict rejected ✓; absent
  number/name rejected ✓; name-as-trainNumber → `invalid_arguments` ✓
- Identity/position: 1-based UI convention at 1, 9, 25, 120 ✓; 0/1.5 → `invalid_arguments`,
  121 → error ✓; stale position after refresh → error ✓
- Freshness/state: superseded date ✓; superseded route ✓ (new route's train works);
  same-route/date refresh supersedes old version + clears pending selection + stale
  train/position rejected ✓; session mismatch (no search) rejected ✓
- Context/efficiency: render capped at 8, `+112 more` count accurate, full 120-row list
  intact ✓; repeated compaction does not mutate the list (position-120 still selectable) ✓;
  selection turn makes exactly 2 LLM calls (tool + text) — no second resolution call ✓
- Contract: schema + model-facing definition expose the optional fields; `required: []`
  backward compatibility asserted ✓
- UI parity: cards = full 120 rows; card #25's number via number-, name- and
  position-flow all resolve to the same train ✓

## 7. Remaining limitations / approval notes
- The LLM can only forward identities it receives or extracts from the user's message.
  “25th train”/name requests worked in live runs because the user stated them; if a user
  refers vaguely (“wo shaam wali beyond the visible list”) the model still asks — by
  design, no deterministic phrase router was added.
- Position resolution intentionally targets the newest current result list only.
- Memory: full lists are retained per the no-arbitrary-cap requirement; per-row labels are
  compact and ref count stays capped (MAX_RESULT_REFS=8).

## 8. Commit / deployment status
- Local commit: **`84699e0`** ("feat(selection): complete SELECT_TRAIN identity support — number, name, position") on `main`; this report follows as its own commit. Worktree otherwise unchanged.
- **No push, no deployment, no production change, no real booking** — booking/payment/OTP
  flows remain disabled with honest messaging.

## 9. Confirmation
AI model/provider and fallback, system prompts and reasoning strategy, general
tool-calling behaviour (beyond the minimal SELECT_TRAIN definition update this prompt
authorized), provider integrations/credentials, booking safeguards, unrelated UI/routes/
session logic and production configuration were untouched. No test was weakened, deleted
or skipped to obtain a pass; the only skips are the pre-existing LIVE-gated suite and the
build-gated scan (active after build).
