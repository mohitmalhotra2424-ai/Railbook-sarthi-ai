# Prompt 35 — Full Search Results & Voice/Chat Train Selection Consistency

## 1. Root cause (confirmed from actual code)
- `src/assistant/context/store.ts` → `compactItems()` stored `ResultRef.items` as
  `data.slice(0, 8)` — the session/search context used for validation carried only the
  first 8 provider rows.
- `buildContextBlock()` rendered those same `items` into the LLM's context, so the model
  honestly saw only 8 summaries.
- `src/assistant/tools/executor.ts` → `SELECT_TRAIN` resolved the requested number against
  `ref.items` (the truncated 8). Any train beyond position 8 — visible in the UI cards,
  which render the full provider list — was rejected as "NOT in the current valid search
  results" (live case: 12030 SWARN SHATABDI at position 25, LDH→NDLS, 31 rows returned).
- A secondary identity-safety gap existed in the matcher: `label.startsWith(trainNumber)`
  let a 4-digit prefix (e.g. `1203`) silently match `12030 …`.

## 2. Files changed and why
| File | Change |
|---|---|
| `src/assistant/context/store.ts` | `compactItems()` no longer truncates — the **complete** provider row list is retained (per-row labels stay compact). Only the LLM's *rendered* context is capped: first `MAX_CONTEXT_ITEMS = 8` summaries in the existing `index) label` format plus an honest `(+N more in current results — selectable, not listed)` marker. |
| `src/assistant/tools/executor.ts` | `SELECT_TRAIN` now matches the train number as a **full token** (`label === n` or `label.startsWith(n + " ")`), so a numeric prefix can never silently select a longer number. Validation still runs only against current non-superseded `SEARCH_TRAINS` refs. |
| `tests/unit/selection-full-results.test.ts` | New 13-test regression suite (deterministic doubles; 120-row fixture). |
| `tests/unit/load-resilience.test.ts` | The one test that asserted the *validation store* itself must be truncated: now asserts the full 5000-row list is retained while the LLM rendering stays at 8 (`10008` absent, `+4992 more` marker). |

No other source file touched. No AI model/provider, system prompt, reasoning strategy,
general tool-calling behaviour, tool schema, provider integration, credential, UI theme,
booking flow or deployment configuration changed. Nothing pushed or deployed for this
change (previous commit `1f47085` — the interim 150-row-bound version of this fix — was
already live before this prompt; the present refinement supersedes it locally only).

## 3. How full authoritative results are retained for backend validation
- `recordToolResult()` stores every provider row as a compact `{index, label, classes}`
  entry on the result ref — **no arbitrary fixed maximum** (no 40/100/150 cap). Rows are
  compact single-line labels, and ref count remains bounded (`MAX_RESULT_REFS = 8`), so
  memory stays linear in the provider's own row count.
- `SELECT_TRAIN` reads the same `ref.items` the UI cards derive from, filtered to
  `tool === "SEARCH_TRAINS" && !supersededBy` — UI cards, chat selection and backend
  validation all resolve against the same current search session and authoritative set.

## 4. How the 8-item LLM context limit is preserved
- `buildContextBlock()` slices rendering to the first 8 summaries (unchanged format),
  appending `(+N more in current results — selectable, not listed)` when the authoritative
  list is longer. Full lists are never sent to the LLM. Proven by tests 12/13 below and by
  the load-resilience overflow test (5000 rows → prompt still shows 8).

## 5. Number/name-based voice/chat selection beyond position 8 — actual support
- **By train number: SUPPORTED.** Voice and chat both flow through the same turn pipeline;
  when the user says/mentions the number ("12030 select karo"), the LLM calls the existing
  `SELECT_TRAIN` with that number and the backend now resolves it against the complete
  current results (positions 25/40/100+ proven by tests).
- **By name: NOT supported beyond the LLM-visible 8 — documented boundary, not
  redesigned.** The existing contract is `SELECT_TRAIN { trainNumber: 4–6 digits }`; the
  tool definition instructs the model to resolve names against the visible item indexes.
  For a train beyond position 8 the model cannot map name→number from its context, and
  forwarding a name fails schema validation (`invalid_arguments`, test 7) — so nothing
  wrong is ever selected; the assistant asks for the number instead.
  **Smallest change for approval (not implemented):** add an optional `trainName` field to
  `SELECT_TRAIN`, resolved on the backend by exact/normalized name match against the full
  current results, rejecting ambiguous matches for clarification. This touches the tool
  schema + tool definition text, hence approval is required per this prompt.
- **By position ("25th position train"): same boundary** — indexes beyond 8 are not in the
  LLM context. UI card taps carry the card's authoritative train number, so tapping any
  card (any position) works today (test 5).

## 6. Test results
New suite `tests/unit/selection-full-results.test.ts` — **13/13 passed** (120-row fixture):
1. ✅ Positions 3 & 8 (within first 8) selectable
2. ✅ Position 25 selectable (the live 12030 case) — passenger form opens with it
3. ✅ Position 40 selectable
4. ✅ Positions 100 and 120 (last row) selectable
5. ✅ Card at position 25 → its authoritative number → validated against same result set
6. ✅ (number flow, same mechanism as 2 — voice and chat share the turn pipeline)
7. ✅ Name-as-trainNumber rejected by schema (`invalid_arguments`); nothing selected
8. ✅ Absent train (`99999`) rejected; nothing selected
9. ✅ Superseded search (date change) — its trains rejected
10. ✅ Route-change supersede — old route's trains rejected, new route's train selectable;
    ✅ session mismatch (no search at all) rejected
11. ✅ Ambiguity: numeric prefix `9000` never selects `90001…`; name flow never guesses
12. ✅ LLM context capped at 8 summaries (`8) 90008` present, `90009` absent,
    `+112 more` marker)
13. ✅ Repeated compaction does not mutate/truncate the authoritative list (120 rows
    before and after; position-120 train still selectable afterwards)

14. ✅ **Existing suites continue to pass:** full unit run `vitest run` →
    **339 passed, 6 skipped** (search, selection, freshness/stale, supersede, P25–P34
    suites included). Typecheck `tsc --noEmit` clean. Lint: only the 2 pre-existing errors
    in `app/review/page.tsx` (untouched). `next build` compiled successfully. Full
    Playwright E2E: **245 passed**.

## 7. Limitations requiring separate approval
- Name-based and position-based selection beyond the LLM-visible 8 (see §5) — needs a
  minimal `SELECT_TRAIN.trainName` schema addition + tool-definition text change.
- Memory note: retaining full lists means a provider returning an extreme payload
  (synthetic 5000-row case) keeps ~5000 compact rows per ref in memory. Ref count stays
  capped at 8 and LLM rendering at 8; no functional bound was added per this prompt's
  instruction against arbitrary maxima.

## 8. Untouched-confirmation
AI model/provider (NVIDIA muse-glimmer-30b + gpt-oss-20b fallback), system prompts,
reasoning/tool-selection behaviour, general tool-calling, booking/payment/IRCTC/OTP/CAPTCHA
flows, provider integrations and credentials, UI theme/layout and deployment configuration
were **not modified**. No push and no deploy were performed for this change.
