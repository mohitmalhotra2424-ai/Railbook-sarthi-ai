# Prompt 41 — Degraded-Mode Claim Safety & Result/Response Consistency

**Date:** 2026-10-12 · **Baseline:** production @ `2932151` (P38 code `f3a52ca`) — verified unchanged before edits
**Scope:** local changes only; nothing pushed or deployed by this task.

---

## 1. Reproduced root cause

During Prompt 40's post-deploy smoke check (production, LLM flaky window), a
turn ran: `FILTER_TRAINS {availableOnly}` → **error** ("no current search
results to filter") → the model recovered with `SEARCH_TRAINS` → ok, 30 raw
cards — and the (fallback) model headed the raw list **"(3A seats
confirmed)"**. Nothing had been checked; the cards themselves honestly showed
WL/RAC/AVL. The defect was the **unsupported conversational claim**, not the
Prompt 38 classifier.

Why it was possible: the orchestrator feeds tool results (including the error
note) back to the model, but the final reply passed through only ONE
deterministic claim guard — the Prompt 26 `guardSaveClaims` for passenger
save claims. No equivalent guard existed for availability/filter claims, and
the error note did not tell the model how to label post-failure raw results.

## 2. Fix — smallest safe change, additive on the accepted P26 pattern

| File | Change |
|---|---|
| `src/assistant/tools/results.ts` | `ToolResult.availabilityFilter?: { classCode, checked, available, unavailable, unknown, complete }` — the smallest necessary structured metadata distinguishing a **real, completed availability operation** from everything else. Prose-free counts. |
| `src/assistant/tools/executor.ts` | (a) `FILTER_TRAINS` sets `availabilityFilter` ONLY when `availableOnly` checks actually ran (status ok). Plain filters carry none — a filter is not a check. (b) The no-search-ref error note now states the filter did NOT run, nothing was checked, and any subsequently fetched results are RAW and UNFILTERED — never to be described as confirmed/filtered. |
| `src/assistant/availability-claim-guard.ts` (new) | `guardAvailabilityClaims` — mirrors `guardSaveClaims`: regexes only LOCATE candidate claim sentences (EN/Hinglish/Hindi incl. Devanagari); every verdict is decided by **structured outcomes of THIS turn** (`availabilityFilter` counts, failed FILTER ops, ok `CHECK_AVAILABILITY` classes, raw-search presence). Pure function, no side effects, no tools, no state mutation. |
| `src/assistant/orchestrator.ts` | Runs the new guard on the final reply right after the save-claim guard; logs adjustments; the corrected text goes into the single `message` event → **text and voice stay truthful by construction** (both channels consume that one event). |
| `src/assistant/prompts.ts` | ONE added response-contract bullet: availability/filtered wording requires a status-ok FILTER_TRAINS/CHECK_AVAILABILITY this turn; authoritative counts (partial ≠ all; incomplete ≠ "no train available"); after a FAILED filter, raw search results must be labeled unfiltered. No rewrite. |

No changes to: availability classifier, three-state semantics, AVL vocabulary,
class resolution, refresh/reuse, failover, rate limits, concurrency/time
budgets, `availabilityBatch` lifecycle, selection rules, supersede
protections, providers, or booking flows. Primary and fallback models pass
through the identical guard (verified by test 10). No second LLM call, no
phrase-list router: replacement happens only after a structured verdict, never
by keyword-substituting model prose.

## 3. How raw vs filtered/confirmed results are distinguished

- **Structured provenance:** only a `FILTER_TRAINS` result with `status ok`
  **and** an `availabilityFilter` payload (set exclusively by the real-check
  code path) constitutes "successfully filtered by availability". Raw
  `SEARCH_TRAINS` results never carry it; plain filters never carry it.
- **Turn-scoped evidence:** the guard sees only the current turn's results, so
  stale/superseded/earlier-turn evidence cannot authorize a claim (by
  construction — test 6).
- **Claim → verdict mapping:** positive claim needs matching class,
  `available > 0`, and (for "all/sabhi") `complete`; universal negatives
  ("koi train available nahi") need a complete verified negative;
  failed-filter + raw-search yields the honest "filter complete nahi hua;
  ye raw search results hain" disclosure instead.

## 4. Tests added — `tests/unit/prompt41-claim-safety.test.ts` (12)

Required cases → tests: (1) P40 repro at guard level + end-to-end through
`runTurn` (failed filter ⇒ honest heading, raw list preserved); (2) mixed
AVL/WL/RAC raw results never imply "all available" (EN + Hinglish + Hindi
variants); (3) complete successful filter ⇒ accurate confirmed wording
untouched; (4) partial ⇒ subset wording passes, "ALL" wording corrected to
describe partial coverage; (5) all-failed ⇒ "no train available" blocked,
complete negative passes; (6) stale/earlier-turn evidence cannot justify a
claim; (7) 3A results never support an SL claim; (8) FALLBACK model gets the
same truthful metadata and its false claim is corrected identically
(`viaFallback: true` asserted); (9) voice/text parity — exactly one message
event carries the corrected claim; (10) P38/39 suites re-run unchanged. Plus
executor evidence test: `availabilityFilter` counts exact (2/1/5, complete
false) and absent for plain filters. Mocked outcomes — deterministic unit
evidence only; mocks never prove production behaviour (live evidence §6).

## 5. Verification (commands + exact counts)

```
npx vitest run tests/unit/prompt41-claim-safety.test.ts   → 12 passed
npx vitest run                                            → 400 passed / 6 skipped (46 files + 1 skipped)
npx tsc --noEmit                                          → clean
npm run lint                                              → 2 errors, 0 warnings — BOTH pre-existing
                                                            (review/page.tsx setState-in-effect); no new lint failures
npm run build                                             → success
npx playwright test                                       → 245 passed
```

Baseline before changes was 388/6 + 245 — P38's 11 and P39's 8 tests re-ran
unchanged and green (400 = 388 + 12). One note: an early e2e run failed for
environmental reasons (sandbox reset had wiped `node_modules`, the Playwright
browser and its system libs); after `npm ci`, `npx playwright install
chromium` and `install-deps`, the full suite passed — no application failure
was involved.

## 6. Live staging evidence (local prod build, real LLM + real ConfirmTkt — NOT production)

- **Incident scenario** (cold conversation, "sirf 3A confirmed seats wali
  trains dikhao"): model searched (30 raw cards) and opened with an
  unsupported confirmed-seats sentence → guard replaced it: *"There is no
  confirmed availability information this turn — these results are
  unverified."* — all 30 raw cards remained visible with honest WL/RAC/AVL
  statuses; the model's per-train raw status lines stayed intact.
- **Success path** (search → "ab sirf 3A mein confirmed seats wali dikhao"):
  real checks ran (`FILTER_TRAINS` ok) → reply *"…21 relevant trains check
  kiye gaye, in 5 mein 3A confirmed available hai"* passed through
  **unadjusted** — no over-blocking of truthful claims.

No secrets in logs, events, or this report.

## 7. Remaining limitations

- The guard blocks and replaces unsupported claim **sentences**; it cannot
  rewrite a model's overall narrative beyond those sentences (e.g. a model
  sentence describing its own displayed sublist — "RAC/WL wali trains is list
  mein nahi hain" — is factual about what was shown and passes).
- Per-train claim granularity is class-level: a successful
  `CHECK_AVAILABILITY` this turn supports train-level claims for that class
  (ToolResult carries no trainNumber field; adding one was not the smallest
  change and was not needed for the acceptance criteria).
- Claim detection covers EN/Hinglish/Hindi (Devanagari + romanized); other
  languages fall back to untouched prose (product languages are hi/en).
- Staging evidence is from a local production build with live providers; it
  demonstrates the guard firing end-to-end but is not a production deployment
  (none was performed for this task).

## 8. Commit

One local commit on `main`, subject "Prompt 41: degraded-mode claim safety —
availability claims must match structured tool outcomes" (NOT pushed;
origin/main remains `2932151`; the hash is omitted here because this report
file is part of that same commit). Contents: guard module +
orchestrator/results/executor/prompts changes + 12 tests + this report.
