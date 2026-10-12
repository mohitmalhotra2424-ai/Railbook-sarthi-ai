# Train-List / SELECT_TRAIN Consistency Fix (Full-Results Selection)

## Symptom (verified on live)
User searched LDH → NDLS on 2026-10-12. The provider returned **31 trains**; the UI cards
rendered all of them, including **12030 SWARN SHATABDI at position 25 (dep 18:55)**. When the
user asked to select it, the assistant replied that 12030 was "not in the list" and listed
exactly 8 trains — matching the provider's **rows 1–8** verbatim.

## Root cause
- `src/assistant/context/store.ts` → `compactItems()` capped `ResultRef.items` at
  `data.slice(0, 8)` when recording a `SEARCH_TRAINS` result.
- `buildContextBlock()` rendered those same `items` into the LLM's conversational context —
  so the model genuinely only saw 8 trains (its answer was honest w.r.t. its context).
- `src/assistant/tools/executor.ts` → `SELECT_TRAIN` validated the requested train number
  against `ref.items` — i.e. against the truncated 8, not the full authoritative list the UI
  cards display.
- Net effect: any train beyond position 8 was visible in the UI but unselectable, and the
  assistant contradicted the user's screen.

## Fix (minimal, no architecture change)
1. **Full authoritative set retained in the existing session store.** `compactItems()` now
   keeps up to `MAX_SELECTION_ITEMS = 150` rows (bounded purely as a defense against
   abuse-sized provider payloads; real lists are far smaller — the live case had 31).
   `SELECT_TRAIN` validation logic is unchanged in code but now validates against the full
   current set automatically, because it reads the same `ref.items`.
2. **LLM rendered context still capped at 8.** `buildContextBlock()` renders only the first
   `MAX_CONTEXT_ITEMS = 8` items in the existing `index) label` format, now with an honest
   marker when truncated: `(+N more in current results — selectable, not listed)`.
3. **All protections untouched:** search-version refs (`r1…rN`), journey date/route change
   → supersede older `SEARCH_TRAINS` refs (`SUPERSEDED by rX`) and clear
   selection/passengers; `SELECT_TRAIN` only considers refs where
   `tool === "SEARCH_TRAINS" && !supersededBy`; `MAX_RESULT_REFS = 8` refs retained;
   freshness (`retrievedAt`) and stale handling unchanged. No keyword routing, no new
   orchestrator, no second agent, no model/provider/prompt/tool-schema change, no booking
   logic touched.

### Files changed
- `src/assistant/context/store.ts` — constants + `compactItems` bound + context render cap
  with `+N more` marker + doc comments.
- `tests/unit/load-resilience.test.ts` — the one test that wrongly asserted the *validation
  store* itself must be ≤ 8 rows (its real intent is memory-bounding a 5000-row abuse
  payload): assertion updated to the selection-set bound (≤ 150). Conversational cap-at-8
  behaviour remains proven by tests below.
- `tests/unit/selection-full-results.test.ts` — NEW regression suite (6 tests, deterministic
  doubles: scripted LLM + 30-row fixture provider).

## Regression tests (new, all pass)
1. Train within the first 8 results is selectable.
2. Train beyond the first 8 (position 25) is selectable; passenger form opens with it.
3. Train absent from the current full results is rejected; nothing is selected.
4. Train present only in a **superseded** search (date changed) is rejected.
5. LLM's rendered conversational context stays capped at 8 items (`8) …` present, 9th
   absent, `(+22 more in current results` marker present) while the stored validation set
   is complete (30).
6. UI cards and chat/tool selection share the same current authoritative set (cards = 30
   rows; card #25 train number === SELECT_TRAIN-accepted train number === stored selection).

## Verification (actual results)
| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` | 2 pre-existing errors in `app/review/page.tsx` (untouched) |
| Targeted tests | `npx vitest run selection-full-results store multiturn load-resilience passenger-selection` | **31 passed** |
| Full unit suite | `npx vitest run` | **332 passed, 6 skipped** (was 326/6; +6 new) |
| Build | `npx next build` | success |
| Full E2E | `npx playwright test` | **245 passed** (2.9 min; chromium + OS libs reinstalled after sandbox reset) |

Live reproduction before the fix (local debug server, confirmtkt-v1): 31 rows returned;
12030 at row 25; LLM listed rows 1–8 only. After the fix the same validation path accepts
row 25 (proven by regression test #2/#6 with the identical mechanism).
