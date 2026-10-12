# Prompt 32 — RailSaarthi Full Booking-Preparation Acceptance Audit
## Acceptance Report

Date: 2026-10-12 · Baseline: `main` @ `2b82743` (P31), working tree clean except pre-existing untracked probe screenshots (`scripts/ui-probe-*.png`), which were preserved untouched. P31 commit `2b82743` present in history; P27–P31 reports read; **the P31 implementation was re-verified in code, not taken on report trust** (store L75 required fields, L225-240 review hook, L300-420 review boundary; orchestrator L330-336 age-only recovery; route actions; UI panel).

Audit-first milestone. One small defect reproduced and fixed (see §10); everything else verified as-implemented.

---

## 1. Required-passenger-field matrix (verified against `validate.ts`, store, UI, tests)

| Field | Validation rule (existing) | Frontend behaviour | Backend behaviour | Test ref |
|---|---|---|---|---|
| name | text, 3–60 chars, letter-led charset | input + check/next markers; error line on reject | `validateName`; 400 on reject; not saved | A, B, C |
| age | whole number 1–120 | same; invalid keeps typed value for correction, state unchanged | `validateAge`; 400; not saved | A–D, e2e form test |
| gender | male/female/other (aliases m/f/o) | same | `validateGender`; 400 | A–C |
| berth | non-empty ≤40 chars; **required for review** (owner rule P31) but labelled request-only, never a guarantee | mandatory label + honest note; error line | `validateBerth`; missing → `PASSENGER_INCOMPLETE`, review blocked | A, B, D, F |

No other fields exist in the contract (`food` is explicitly rejected; verified in `validatePassengerField` switch). Optional-ness: only fields the contract defines as required are required — berth is required per the standing owner rule; nothing else was added.

## 2. Enforcement evidence — incomplete/invalid data cannot reach review

- **A** each field missing alone → `ready:false`, exact `missingFields`, `buildReview` 400-path. `p32 A`
- **B** all missing → all four listed. `p32 B`
- **C** invalid values rejected at validator AND `/api/passenger` (400, state unchanged). `p32 C` + e2e form invalid-age test
- **D** failed save ≠ complete: 400 response, readiness still missing the field, review blocked. `p32 D`
- **H** direct API `review`/`confirm` on incomplete state → 400 (backend revalidates; UI button state is never the authority). `p32 H`
- **F/G** multi-passenger independent validation; count changes recalc readiness; adds blocked while current passenger incomplete. `p32 F, G`
- UI re-evaluates from authoritative state after every update (event + every `/api/passenger` response carries `readiness`/`review`). `PassengerFormPanel.tsx`

## 3. Review invalidation & stale data (§5)

`p32 J`: passenger-detail, class, train, journey-date and route changes each invalidate an existing review; date/route change supersedes the search and clears selection (existing P25 rule). `p32 I`: stale (`freshness:"stale"`) availability or fare blocks review (`STALE_AVAILABILITY`/`STALE_FARE`); a successful new lookup invalidates the review; **a FAILED lookup invalidates nothing** (defect fix, §10). `p32 K`: a review whose snapshot no longer matches authoritative state cannot be confirmed and is invalidated. Stale data is never shown as current: review block renders only authoritative state; readiness treats stale as blocker.

## 4. Confirmation & handoff (§6)

`p32 L`: confirm with no review / after confirmation rejected. `p32 M`: explicit validated confirm → `review.status:"confirmed"` + `handoff:"IRCTC_HANDOFF_READY"`; UI banner states "Actual booking execution is not enabled." `p32 N`: chat "haan, confirm karo" over a pending review leaves it `awaiting_confirmation`; the model is offered **no** confirm/book tool (tool list asserted). `p32 R`: API surface = `assistant|health|passenger|railway`; all railway routes GET-only (read queries; cancellations route is a read-only status surface); store has no book/pay/submit/cancel/login/OTP/CAPTCHA/PNR methods. No provider activated, no fake PNR possible.

## 5. Prompt 28/29 age-only recovery (§7)

Code re-inspected: recovery eligibility still requires a blocked **age** claim + form open + age authoritatively missing + single `recoveryUsed` shot (orchestrator L330-336). P29 suites (incl. "G: berth claims blocked without recovery") re-run green in the 304-test unit pass. Not broadened, not relocated.

## 6. AI / tool / text-voice regression (§8, §2)

Zero diff this milestone to model/provider settings, prompts, tool definitions/schemas/descriptions, tool_choice, dispatcher, orchestrator loop, provider adapters. `p32 N` asserts no confirmation-style tool introduced. General railway Q&A suites (`conversation-qa`, `multiturn`, `concurrency-isolation`) green in unit run. Text & voice share `/api/assistant` + same store (voice e2e green in the 200-test playwright run). No duplicate final messages (P28 J suite green).

## 7. End-to-end journey (§4) — simulated acceptance (fixtures/mocks; clearly not live)

Steps 1–15 covered by: `tests/e2e/passenger-form.spec.ts` (form opens on train+class; missing-field review blocking incl. berth; review→confirm→handoff banner; invalid manual edit rejected), `tests/e2e/ui-interactions.spec.ts` (selection + class tap), `tests/e2e/voice.spec.ts` (same pipeline), `tests/unit/p31-preparation.test.ts` + `p32-acceptance.test.ts` (readiness/review/confirm boundaries), `p30-journey`/`passenger-selection` suites (unambiguous/ambiguous selection vs current results). Live-provider verification remains exclusively in the env-gated `live-verify` unit file and `scripts/live-*.mjs` from earlier milestones (6 skips this run = that gate).

## 8. Test commands & actual results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors / 0 warnings |
| `npx next build` | clean |
| `npx vitest run` | **304 passed / 6 skipped** (skips = env-gated live-verify; intended) |
| `npx playwright test` | **200/200** |

Environment failures (not code): sandbox resets wiped `node_modules`, Playwright browsers and OS libs twice — restored via `npm install`, `npx playwright install chromium`, `npx playwright install-deps chromium`; the interim "195 failed" runs were the missing-browser condition (browser-less `health` spec passed then). Pre-existing code failures: **none**. New code failures introduced then fixed during audit: 0 shipped (the two E/M test failures were my harness using <8-char conversation IDs rejected by the route's ID regex — a correct backend rejection; test IDs corrected, backend unchanged).

## 9. Acceptance statuses

| Requirement | Status |
|---|---|
| §3 mandatory-field rule at UI + backend, exact missing display, re-eval after updates | **PASS** (§1–2) |
| §4 end-to-end journey to preparation-only handoff, booking-not-executed stated | **PASS** (simulated; §7) |
| §5 invalidation incl. stale fare/availability; no stale shown as current | **PASS** (§3) |
| §6 confirmation boundary; conversational text cannot bypass; disabled list intact | **PASS** (§4) |
| §7 age-only recovery preserved | **PASS** (§5) |
| §8 AI/tool/text/voice regressions | **PASS** (§6) |
| §9 matrix A–R | **PASS** (`p32-acceptance.test.ts` A–R + re-run suites O/P/Q) |
| §10 defect handling | one defect fixed (§10); no redesigns |

## 10. Defect found & fixed

**Reproduced:** the P31 review-invalidation hook cleared an existing review on *any* `SEARCH_TRAINS`/`CHECK_AVAILABILITY`/`GET_FARE` result — including failed lookups (`error`/`timeout`/`unavailable`/`not_configured`) that return no data and change no fact (over-invalidation). **Fix (scoped, no AI/architecture change):** `src/assistant/context/store.ts` — hook now fires only for `status === "ok" | "stale"`. **Regression test:** `p32 I` (review survives a failed lookup; stale data still invalidates). Not changed (documented limitation): the pre-existing P25 supersede rule also clears selection/passengers when a *failed* search carries a different date/route — existing, test-defined behaviour outside this audit's scope; left as-is per "do not rewrite working services".

## 11. Files changed (P32)

| File | Reason |
|---|---|
| `src/assistant/context/store.ts` | narrow review-invalidation to results that actually returned data |
| `tests/unit/p32-acceptance.test.ts` | NEW — acceptance matrix A–R (15 deterministic tests) |
| `docs/prompt32-booking-preparation-acceptance-audit.md` | this report |

## 12. Remaining limitations

- Confirmation stays an explicit validated UI action; conversational confirmation would need an owner-approved LLM tool (keyword routing forbidden).
- Supersede-on-failed-search (P25) documented above, unchanged.
- Live-provider acceptance not re-run this milestone (env-gated; earlier live runs remain on record).

## 13. Booking/payment disabled — confirmed

`p32 R` + code inspection: no booking/payment/OTP/CAPTCHA/login/cancellation-execution/PNR surface exists; `IRCTC_HANDOFF_READY` is preparation-only and the UI says so.
