# Prompt 38 — Real Provider Availability Check for All Current Search Results

**Code commit:** `f3a52ca` (this report committed separately)
**Date:** 2026-10-12 · **Scope:** minimal additive reliability fix to `FILTER_TRAINS.availableOnly`

---

## 1. Root cause

`FILTER_TRAINS { availableOnly: true }` never checked anything. It only read
`CHECK_AVAILABILITY` results that happened to be recorded in the conversation
previously (executor, old lines ~228–243). For a natural request like
*"sirf confirmed seats wali trains dikhao"*, the model called
`FILTER_TRAINS { availableOnly: true }` and got back whatever had been
individually checked before — usually nothing — so the feature silently
returned an empty/incorrect list instead of the trains with confirmed seats.
Presence in search results was (correctly) never treated as availability, but
no real checks were ever triggered either.

## 2. Fix (files changed)

| File | Change |
|---|---|
| `src/assistant/tools/executor.ts` | `availableOnly` now runs a **real bounded batch of live `seatAvailability` checks** through the existing `executeCapabilityFailover` path: class resolved `args → selection → journey context` (else ONE clarification, never a guess); route/date/class taken from the latest non-superseded search; concurrency bounded to **3**, per-check 15s timeout (`TOOL_TIMEOUT_MS`), **45s soft budget** (remainder honestly reported as not verified); still-valid checks (5-min window, same train/class/date) are reused unless `refresh: true`; confirmed outcomes stored on the search-version ref; honest three-state counting + partial-failure note. `withTimeout` now removes its abort listener on settle (batches leaked one listener per check → `MaxListenersExceededWarning`). |
| `src/assistant/tools/schemas.ts` | `FilterTrainsArgs` gains `refresh?: boolean`; `availableOnly` description + tool definition updated ("real live provider checks… requires a class — otherwise ASK"). |
| `src/assistant/context/store.ts` | `ResultRef.availabilityBatch?: { classCode, checkedAt, entries: Record<trainNumber, status> }[]` + `setAvailabilityBatch()` — batch outcomes live **on the search-version ref** (die with it on supersede; never bloat the 8-ref cap; never evict the authoritative SEARCH ref). |
| `tests/unit/prompt38-availability.test.ts` | 11 new deterministic unit tests (mock adapter). |
| `tests/unit/prompt37-filter.test.ts` | Fixture fix only: seeded recorded checks now carry `retrievedAt` (production results always do). Behavioural expectations unchanged. |
| `scripts/p38-live-run.py` | Live staging harness (no secrets). |

**Not touched:** search semantics, fare, selection identity, provider
adapters, orchestration, system prompt, UI. No new LLM call, no phrase-list
router — the LLM decides to call `FILTER_TRAINS { availableOnly }` exactly as
before; only the executor's implementation of that flag became real.

### Outcome classification (per train, three states — never conflated)

- **available** — provider explicitly published confirmed seats: status
  matches `^(AVAILABLE|AVL)` (`AVAILABLE-5`, `AVL`, `AVL 18`, `AVLS n`).
- **unavailable** — provider explicitly published a no-confirmed-seat state:
  `WL/GNWL/RLWL/PQWL/TQWL`, `RAC`, `REGRET`, `CAN`, … (anything published
  that is not AVL).
- **unknown** — error, rate limit, timeout, budget exhausted, class not
  published, or check never run. Unknown is **never** rendered as
  unavailable or available; unknown trains are excluded from the final list
  and counted separately.

The `AVL` vocabulary was found by **live data**, not guessed: the first
staging run classified 04082 SVDK NDLS SPL (`3A: AVL 18`, a confirmed-seat
train) as unavailable because the initial regex only matched `^AVAILABLE`.
Fixed and covered by a dedicated vocabulary unit test.

## 3. Provider capability & limits discovered

- **confirmtkt-v1** (active, keyless): `availability()` resolves from the
  route's cached `fetchSearch` payload — 60s TTL, single-flight politeness.
  A 21-train batch is therefore ~**1 upstream call** plus local reads. No
  published rate limits (`docs/provider-terms.md`: "None published"); the
  adapter self-limits. Status strings come from
  `availabilityDisplayName`/raw availability (`AVL n`, `WL n`, `RAC n`,
  `Regret`). Missing class ⇒ `NOT_FOUND` (retryable: false) ⇒ counted
  unknown.
- **railyatri-seat-v1**: inactive (no credential) — failover simply skips it.
- No seatAvailability provider configured at all ⇒ `notConfiguredEnvelope`
  ⇒ every pending train counted **unknown** with explicit disclosure
  ("No live availability provider is configured…"), plus recorded-check
  reuse still works.
- Rate limits are never disabled or bypassed anywhere; failed checks are
  attempted exactly once per request (bounded retry only across separate
  user requests).

## 4. Behaviour before / after

| | Before | After |
|---|---|---|
| "Sirf 3A confirmed seats wali trains dikhao" | filtered previously-recorded checks only (usually 0 trains, misleading) | live-checks every relevant train (bounded), lists only provider-confirmed ones |
| Provider failure | n/a (nothing checked) | counted "could not be verified", listed count, never "no trains available" |
| Repeat request | re-filtered same refs | reuses still-valid checks; `refresh` re-checks everything |
| Date/route change | refs could go stale | new journey ⇒ new checks; batch storage dies with superseded search |
| Selection | unaffected | unaffected (still validates against FULL authoritative search) |

## 5. Verification

### Unit (mocks — deterministic; mocks never prove live behaviour)

- `npx vitest run` → **380 passed / 6 skipped** (baseline was 369/6; +11 new
  P38 tests). No pre-existing failures; all skipped tests are pre-existing
  credential-gated ones.
- `npx tsc --noEmit` → clean.
- `npm run lint` → 2 errors, **all pre-existing** (`review/page.tsx`
  setState-in-effect), 0 warnings.
- `npm run build` → success.
- `npx playwright test` → **245 passed** (2.8m).

New tests cover: real tool execution for every relevant train with correct
route/date/class; only confirmed-available in the final list;
unavailable/unknown excluded; exact partial counts ("12 trains checked: 4
available, 4 unavailable, 4 could not be verified. Results are partial.");
zero-available complete-vs-incomplete distinction; bounded concurrency
(observed max 3, one attempt per train — no floods/retry storms on
RATE_LIMITED); reuse + explicit-refresh freshness; date-change contamination
blocked; class missing ⇒ clarification with zero provider calls; class
fallback from selection; ConfirmTkt/IRCTC status vocabulary; outcomes stored
on the search ref without evicting it; plain filters never call the
availability provider; selection from the filtered view (incl. a waitlisted
train) still authoritative. Chat and voice share the same executor path, so
the same rules apply to both (voice e2e green).

### Live staging (real provider, real LLM — production build, port 3107, `RAILWAY_PROVIDER_IDS=confirmtkt-v1,erail-v1,web-data-v1`)

Route **LDH→NDLS, 2026-10-15**, class **3A**; search returned **30** cards,
**21** relevant for 3A.

1. *"15 October ko Ludhiana se Delhi jaana hai, trains dikhao"* →
   SEARCH_TRAINS ok, 30 cards (7.4s).
2. *"Sirf 3A mein confirmed seats wali trains dikhao"* → `FILTER_TRAINS
   {classCode:"3A", availableOnly:true}` → **5 cards**: 04082 (AVL 18),
   12550 (AVL 41), 12926 (AVL 22), 18238 (AVL 12), 22402 (AVL 10). Reply
   states 5 confirmed out of 21 relevant trains checked (14.9s total turn).
   Actual provider requests: ~1 upstream search fetch (60s cache) + 21 local
   payload reads; no rate limiting observed; no listener-leak warnings.
3. *"Abhi fresh check karke 3A confirmed wali trains dikhao"* →
   `refresh:true` inferred → full re-check, same 5 confirmed, reply: "21
   trains check ki, in 5 mein hi 3A confirmed hai" (11.2s).
4. *"12926 select karo 3A mein"* → SELECT_TRAIN + SELECT_CLASS ok → asks for
   passenger details (selection from the filtered availability view works;
   identity unchanged).

Before the vocabulary fix, run #2 wrongly reported 0 available / 21
unavailable — the exact failure mode the new vocabulary test now guards.

No secrets in logs, events, or this report.

## 6. Known limitations

- **No incremental progress UI** ("8 of 31 checked") — no existing
  batch-progress mechanism exists in the chat UI; adding one would be an
  unrelated UI change (out of scope). The final message carries exact
  checked/unverified counts instead. Turn times for large batches are bounded
  by the 45s soft budget; beyond it, remaining trains are reported as not
  verified (partial), never guessed.
- **All-classes mode not implemented** — cost/semantics for every-class
  checks aren't verified, so `availableOnly` requires exactly one class
  (per prompt allowance). The LLM asks one concise clarification when no
  class is known.
- Reuse window for confirmed checks is 5 minutes (matches ConfirmTkt's fare
  TTL); an explicit refresh always bypasses it.
- Batch entries carry status but not the provider `asOf` per class in the
  filtered card view (the underlying card still shows search-payload `asOf`
  where present).
- Unit-test mocks prove logic only; live ConfirmTkt evidence above is the
  live proof. Both are reported separately for that reason.

## 7. Test commands

```
npx vitest run                                  # 380 passed / 6 skipped
npx vitest run tests/unit/prompt38-availability.test.ts   # 11 passed
npx tsc --noEmit                                # clean
npm run lint                                    # 2 pre-existing errors only
npm run build                                   # ok
npx playwright test                             # 245 passed
python3 scripts/p38-live-run.py                 # live staging harness (needs local prod server)
```
