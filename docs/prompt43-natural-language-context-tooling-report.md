# Prompt 43 — Natural-Language Intelligence & Context-Aware Tool Orchestration: Verification & Gap-Analysis Report

**Date:** 2026-10-12 · **HEAD:** `1f58972` (branch `main`, clean worktree)
**Outcome:** Prompt 43 re-issued the Prompt 37 specification verbatim. Inspection confirmed the
entire capability set is **already implemented, tested, and deployed** — delivered by Prompt 37
(`f12c64f`, report `e6a7d85`) and extended by Prompt 38 (`f3a52ca`), Prompt 39 (`2932151`) and
Prompt 41 (`1f58972`). Per the task's own rules ("determine which of these capabilities already
exist… do not duplicate existing functionality"), **no production code was changed for this
milestone**; the only file added is this report.

---

## 1. What already existed (verified in the actual code this turn)

| Capability (per Prompt 43 §2–§9) | Implementation |
|---|---|
| NL understanding, Hindi/Hinglish/English, no phrase router, no 2nd LLM call | Existing LLM tool-calling pipeline (`orchestrator.ts`); `prompts.ts` honesty/response contract only. No keyword router exists or was added. |
| Reusable filter/sort over current authoritative results | `FILTER_TRAINS` tool (`schemas.ts` `FilterTrainsArgs` + `executor.ts` derived-view branch): `classCode` (schema text: "'Runs in this class' is NOT the same as seats being available"), `availableOnly`, `refresh`, `departsAfter/Before`, `arrivesAfter/Before` (departure vs arrival distinguished in the schema itself), `maxDurationMinutes`, `sortBy: fare\|duration\|departure\|arrival`, refine ≥1 criterion. |
| Class-level availability = REAL checks | Prompt 38: bounded batch (concurrency 3, 15s/check, 45s budget) through the existing provider failover; three-state AVAILABLE/UNAVAILABLE/UNKNOWN; AVL vocabulary; 5-min reuse + explicit `refresh`; search-version-bound `availabilityBatch`. |
| Fare comparison / "sabse sasti" | `sortBy: "fare"` ranks only trains with checked `GET_FARE` data; unchecked trains last; no invented prices (P37 live evidence). |
| Never mutate authoritative results; selection from filtered views | FILTER builds a derived view; selection always validates against the full non-superseded `SEARCH_TRAINS` items (P37/P38/P39 tests). |
| Context retention & reference resolution ("sirf 3A", "doosri train") | Conversation store journey context (route/date/class/train) + bounded 8-summary context block; supersede marks for stale/superseded refs. |
| No-results honesty / no silent weakening | Honest 0-match notes with exact criteria; P41 claim guard blocks unsupported confirmed/available wording based on structured outcomes. |
| Stale/superseded/session protections | Existing supersede machinery (date/route/same-journey refresh), extended for FILTER views (P37). |
| Voice/text parity | Single orchestrator message event consumed by both channels (asserted in P41 test 9; voice e2e green). |
| Booking/payment/OTP disabled | Unchanged throughout. |

## 2. What was missing

**Functionally: nothing.** One documented UI limitation stands (also recorded in the P38 report
§6): no incremental batch-progress display ("8 of 31 checked"); exact checked/unverified counts
are disclosed in the final message instead. Adding one would be a UI change outside this scope.

## 3. Files changed by Prompt 43

- `docs/prompt43-natural-language-context-tooling-report.md` (this file). **Zero** source, test,
  schema, prompt, or config changes — duplicating the delivered P37–P41 work would have violated
  the task's reuse rule.

## 4. Tool/function-calling flow (as built)

User text/voice → single LLM turn (existing model/provider) → optional tool calls
(`SEARCH_TRAINS`, `FILTER_TRAINS`, `CHECK_AVAILABILITY`, `GET_FARE`, `SELECT_TRAIN`, …) →
backend zod validation + session/freshness enforcement (`executor.ts`) → provider failover →
structured `ToolResult` (incl. P41 `availabilityFilter` counts) → deterministic claim guards →
one `message` event (cards from authoritative refs) → text UI and TTS.

## 5. Verification evidence (run this turn at `1f58972`)

```
npx vitest run tests/unit/prompt37-filter.test.ts tests/unit/prompt38-availability.test.ts \
  tests/unit/prompt39-availability-regression.test.ts tests/unit/prompt41-claim-safety.test.ts
  → 44 passed (13 + 11 + 8 + 12)
npx vitest run            → 400 passed / 6 skipped (46 files + 1 skipped)
npx tsc --noEmit          → clean
npm run lint              → 2 errors, 0 warnings — both PRE-EXISTING (review/page.tsx
                            setState-in-effect); no new failures
npm run build             → success
npx playwright test       → 245 passed (2.9m)
```

Live end-to-end evidence for the Prompt-43 §6 examples is recorded in the existing reports and
production runs: class change + constraint preservation (P37 §7), availability batch + refresh
(P38 §5, P40), successful-filter vs degraded-mode honesty (P41 §6, P42 smoke: "21 relevant trains
check kiye gaye, in 5 mein 3A confirmed available hai" — accurate, guard-adjusted when
unsupported). Those runs were performed in their own milestones; this turn re-verified the test
suites, typecheck, lint, build and e2e — no new live-provider runs were made for P43.

## 6. Performance / freshness trade-offs (unchanged)

Search reuse via 60s provider cache; availability reuse window 5 min with explicit-refresh
bypass; 8-summary LLM context cap intact; full authoritative item lists retained for selection;
no added timeouts, caps, or redundant LLM calls.

## 7. Remaining limitations

- No incremental "N of M checked" progress UI (counts disclosed in final message).
- Claim guard covers EN/Hinglish/Hindi (product languages); other languages pass through.
- Class-level claim granularity for per-train checks (ToolResult carries no trainNumber) — see
  P41 report §7.

## 8. Delivery boundary

Local only: nothing pushed, deployed, or changed in production; production remains `1f58972`.
This report is committed locally for review.
