# Prompt 37 — Natural-Language Intelligence & Context-Aware Tool Orchestration Report

## 1. What already existed (verified in code, baseline `bbb4bc3`, clean worktree)
- LLM-as-interpreter architecture: the model receives journey/selection/passenger context
  and picks tools via function calling (no phrase router anywhere) — Hindi/Hinglish/English
  already flow through the same `/api/assistant` pipeline for text and voice.
- Full authoritative result storage (P35/36): complete `ResultRef.items`, 8-summary LLM
  render cap, SELECT_TRAIN by number/name/position with exact-token matching, supersede and
  stale protections.
- Recorded fare (`GET_FARE`) and availability (`CHECK_AVAILABILITY`) refs with
  freshness/superseded marking; `parseTimesFromLabel` (P33).
- UI cards derived from SEARCH_TRAINS results; class chips; selection mirrored from backend.

## 2. What was missing (the actual gaps this milestone closed)
1. **No way to filter/sort the current results** — the model had no tool to express "sirf
   3A", "subah pahunchne wali", "sabse jaldi"; it could only chat about the 8 visible rows.
2. **Classes were invisible in the LLM context** — item labels carried no class list, so
   even visible-row class follow-ups were guesswork.
3. Filtered views had no lifecycle — nothing defined when a derived view goes stale.

## 3. Files changed (all additive; no existing behaviour altered)
| File | Change |
|---|---|
| `src/assistant/tools/schemas.ts` | ONE new tool: `FILTER_TRAINS` with optional `classCode`, `availableOnly`, `departsAfter/Before`, `arrivesAfter/Before` (HH:MM), `maxDurationMinutes`, `sortBy: fare\|duration\|departure\|arrival` (at least one required). Model-facing definition instructs translating natural language into explicit args, documents the time-of-day convention (morning 04:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, night 21:00–03:59), distinguishes departure vs arrival and "runs in class" vs "available", and states it never invents data. |
| `src/assistant/tools/executor.ts` | Deterministic FILTER_TRAINS branch: derives a view from the newest non-superseded SEARCH_TRAINS ref (source NEVER mutated); joins recorded non-stale GET_FARE / CHECK_AVAILABILITY data; overnight-safe durations; `availableOnly` keeps only trains with a current recorded live check (missing/stale excluded and counted honestly); fare sort ranks checked fares first, unchecked last with an honest coverage count; bounded note (first 8 + "+N more"); no-match returns an honest explanation with one suggested adjustment — constraints never silently weakened. No provider call, no LLM call. |
| `src/assistant/context/store.ts` | (a) item labels now end with provider classes `[3A,2A]` (suffix keeps full-token number matching + name extraction intact — all P35/36 suites re-run green); (b) derived FILTER_TRAINS views are superseded by any newer SEARCH_TRAINS ("newer search results") or newer FILTER_TRAINS ("newer filtered view"). |
| `src/assistant/orchestrator.ts` | `deriveCards` also renders FILTER_TRAINS rows as the same purpose-built cards (filtered view in chat). |
| `tests/unit/prompt37-filter.test.ts` | New: 13 regression tests (24-row fixture with varied classes/times/durations). |
| `tests/unit/orchestrator.test.ts`, `tests/unit/p27-diagnosis.test.ts`, `tests/unit/save-claim-guard.test.ts` | Tool-guard expectations updated 12→13 tools including FILTER_TRAINS (authorized by this prompt; the guards still enforce an EXACT tool list). |

Untouched: model/provider and fallback, system prompts, reasoning strategy, general
tool-calling loop, all other tool schemas, provider integrations/credentials, booking
preparation/review, UI design, voice pipeline, production config. No new dependencies. No
second LLM call, no phrase router, no parallel orchestrator.

## 4. Tool/function-calling flow
User text/voice → existing `/api/assistant` turn → model sees journey + selection +
passenger state + 8 item summaries (now with classes) → model picks a tool (SEARCH_TRAINS
for a new journey, FILTER_TRAINS for a view change, GET_FARE/CHECK_AVAILABILITY for live
data, SELECT_TRAIN to choose) → executor validates args (zod) + session/freshness rules →
deterministic result from authoritative state → bounded note back to the model → natural
reply. Understanding (model) / execution + validation (backend) stay separated.

## 5. Supported filters and data sources
| Filter/Sort | Data source |
|---|---|
| classCode ("runs in class") | provider row classes on the current search ref |
| availableOnly | recorded CHECK_AVAILABILITY refs only (non-stale, non-superseded); absence excluded + counted |
| dep/arr time windows | provider dep/arr on the current rows (arrival ≠ departure criteria) |
| maxDurationMinutes / sortBy duration | computed dep→arr (overnight-safe) |
| sortBy fare | recorded GET_FARE refs only; unchecked trains listed last, coverage stated |
| train identity selection | unchanged P35/36 SELECT_TRAIN against the FULL authoritative list |

## 6. Context retention & invalidation
Route/date/class preferences persist across turns in the existing conversation; a new
preference updates only its own constraint (live-proven below). A newer search supersedes
older searches AND derived filtered views; selections never resolve from superseded data.
The 8-summary render cap applies to filtered views too (bounded note + capped ref render).

## 7. Live end-to-end evidence (real model muse-glimmer-30b + real provider, prod build)
Conversation 1 (LDH→NDLS 14 Oct, 28 rows):
- “Sirf 3A wali trains dikhao” → `FILTER_TRAINS({"classCode":"3A"})` → 21 cards ✓
- “Ab sleeper mein dikhao” → `FILTER_TRAINS({"classCode":"SL","arrivesBefore":"12:00"})` —
  the model itself carried the earlier morning-arrival preference into the new class
  filter ✓ (constraint retention without re-asking)
Conversation 2 (fresh):
- “Subah 10 baje se pehle Delhi pahunchana hai” → `FILTER_TRAINS({"arrivesBefore":"10:00"})` → 12 cards ✓
- “sabse jaldi pahunchne wali sort karke dikhao” → `FILTER_TRAINS({"arrivesBefore":"10:00","sortBy":"arrival"})` — prior constraint preserved + sort ✓
- “12030 select karo” → `SELECT_TRAIN({"trainNumber":12030})` → ok, selection 12030 ✓ (P35/36 intact)
- “Sabse sasti train kaunsi hai?” → model did NOT invent prices; it moved to fetch/clarify
  fares (honest; sortBy-fare ranking is unit-proven when checked fares exist) ✓
Observed variance: in one sequence the model answered a follow-up from the current
filtered context without re-calling the tool — acceptable (data was already authoritative
in context) and never fabricated.

## 8. Test commands & results
| Command | Result |
|---|---|
| `npx vitest run tests/unit/prompt37-filter.test.ts` | **13 passed** |
| `npx vitest run` (full unit) | **369 passed / 6 skipped** (baseline 355/6 stash-verified; +13 new +1 auto-generated tool-sync test for FILTER_TRAINS; 6 skips = LIVE-gated) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 2 errors — both pre-existing (`review/page.tsx` setState-in-effect); 0 new issues |
| `npx next build` | ✓ compiled |
| `npx playwright test` | **245 passed** (voice/text parity suites included — same pipeline, unchanged) |

New-suite coverage: class filter + card view + non-mutation; dep-vs-arr distinction;
duration filter/sort incl. overnight; fare sort with partial data + honest note;
availableOnly with stale/missing exclusion; combined filters; no-match honesty; bounded
LLM list (+N more); schema rejection of empty args; selection from beyond the filtered
view; newer search supersedes the view + stale selection rejected; exactly 2 LLM calls per
filter turn (no second model call); classes visible in context.

## 9. Performance / freshness trade-offs
- Filtering never re-hits the provider (derived from the current ref); required live
  fare/availability checks still go through GET_FARE/CHECK_AVAILABILITY and are never
  suppressed or faked. No caching added; no timeouts changed; no retries added.
- Memory unchanged: same compact rows; filtered refs are compact like all refs.

## 10. Remaining limitations
- `availableOnly` can only include trains already availability-checked — by design
  (never invents); the note tells the model how many were excluded and to run
  CHECK_AVAILABILITY.
- “AC wali” without a specific AC class: the definition tells the model to ask which class
  rather than guess (clarification-over-guessing is intended behaviour).
- Model-side phrasing variance: the model may answer trivially from in-context data
  instead of re-calling FILTER_TRAINS; results remain authoritative either way.
- Booking remains preparation-only; nothing in this milestone touches that boundary.

## 11. Commit / deployment
- Local commit: **`f12c64f`** ("feat(assistant): FILTER_TRAINS — natural-language filtering/sorting of current results") on `main`; this report follows as its own commit.
- **No push, no deployment, no production change, no real booking** — kept local for review
  per this prompt.
