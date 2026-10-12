# Prompt 33 — One-Screen Booking Review & Minimal Clarification Report

## 0. Starting state (verified, not assumed)
- Branch `main`, HEAD `8a6a5d0`, working tree clean (only pre-existing untracked
  `scripts/` probe artifacts, preserved).
- The **Prompt 32 acceptance audit** (`docs/prompt32-booking-preparation-acceptance-audit.md`)
  exists and its status is resolved PASS (baseline `2b82743`), with P27–P31 reports present.
  No unresolved-acceptance blocker; the P32 matrix (required fields, invalidation, stale
  handling, confirm boundary, age-only recovery, provider surface) was re-verified in code
  before this milestone and its suites (`p31-preparation`, `p32-acceptance`, e2e review
  specs) were run green as part of the gates below.
- The one-screen review page (`/review`) already existed from P31/P33-UI work, rendering
  only authoritative `/api/passenger` state. This milestone therefore made **only additive
  gap-closing changes** (per §8: no duplication of working functionality).

## 1. Existing functionality reused (unchanged)
- `BookingPreparationService` (`src/assistant/booking/preparation.ts`): deterministic
  readiness (`ready` / exact `missingFields` like "passenger 1: berth" / blockers /
  warnings; stale & superseded fare/availability = blockers; absence = honest warning).
- Store review boundary: `buildReview` (only when ready) → `awaiting_confirmation` →
  `confirmReview` (only current, awaiting, un-staled snapshot; any booking-critical change
  invalidates) → `IRCTC_HANDOFF_READY` (preparation-only terminal).
- `/api/passenger` GET snapshot + POST `review`/`confirm`/field-save with backend
  revalidation (UI state is never the authority; incomplete → 400).
- Passenger form panel + per-field validators (name 3–60 letter-led, age 1–120 whole,
  gender m/f/o aliases, berth required-for-review request-only; no other fields exist in
  the contract — `food`-style extras rejected).
- LLM context already carries per-passenger `MISSING: field` markers, so the assistant
  asks only for what is missing; P28/29 recovery remains strictly age-field-only
  (untouched). P25 supersede-on-failed-search behaviour untouched.
- Model/provider, prompts, tool schemas, dispatcher, voice/text pipeline: zero changes.

## 2. Files changed and why (all additive)
| File | Change |
|---|---|
| `src/assistant/booking/preparation.ts` | +`parseTimesFromLabel()` (pure): extracts provider-reported dep/arr from a compact result-row label; returns null when absent — nothing invented. |
| `src/app/api/passenger/route.ts` | GET now also returns `times` for the selected train, read from the **current non-superseded** `SEARCH_TRAINS` row (exact full-token match); null when the train is absent, has no reported times, or its search was superseded. |
| `src/app/review/page.tsx` | (a) Journey card now shows **passenger count**; (b) Train card shows provider dep/arr **only when available**; (c) explicit **status pill** distinguishing Review incomplete / Ready for review / Awaiting explicit approval / Preparation complete — booking provider unavailable; (d) "Proceed to IRCTC" is now **rendered but disabled** while required data is missing/invalid or stale (previously hidden) — the explicit approval action is always visible, never usable while blocked; the missing-fields banner naming exact fields is retained. |
| `tests/e2e/tts-review.spec.ts` | Fixtures carry `times`; new assertions for passenger count, times, status states, enabled/disabled button. The block-test assertion changed from button-hidden (`toHaveCount(0)`) to `toBeDisabled()` — same block, matching §2E's "disabled" requirement; backend 400 enforcement unchanged. |
| `tests/unit/prompt33-review.test.ts` | New: 7 tests (label parsing incl. no-invention cases; GET times from current results; absent train → null; superseded search never supplies times; no selection → null, not error). |

No validation, freshness check, confirmation guard or invalidation rule was removed,
bypassed or weakened. No real booking/payment/OTP/CAPTCHA/PNR surface added. No unrelated
UI, routes, session logic or provider code touched. No dependency changes.

## 3. One-screen layout & readiness behaviour
Single mobile-first page (`/review`, `max-w-2xl` column, no sub-navigation):
status pill → Journey card (from → to, date, passenger count) → Train card (number+name,
class, provider dep/arr when available) → Fare (total + verified timestamp, or honest
"stale"/"not verified" with re-check instruction) → Availability (selected class status,
same honest states) → Passengers (per-passenger complete ✓ or exact missing fields) →
missing-fields banner (names fields, links to chat) → Proceed to IRCTC (disabled until
ready) → handoff banner on confirm. Everything comes from the authoritative snapshot;
nothing is fabricated; stale data is labelled, never presented as current.

## 4. Field-by-field minimal clarification (verified)
- Readiness produces exact per-field entries ("passenger 1: age"); the review banner and
  the LLM context `MISSING:` markers use them, so only missing/invalid fields are requested —
  never already-valid values (P32 suites A–D, F–G green again this run).
- Invalid values: rejected at validator and `/api/passenger` (400, state unchanged) —
  review stays blocked (P32 C; e2e invalid-age form test).
- Failed saves never claim success (P26 save-claim-guard suite green).
- New e2e: one missing set (`age, gender, berth`) is named exactly; times render nothing
  when provider data lacks them; pill reads "Review incomplete"; button disabled.

## 5. Backend validation, invalidation & freshness (verified)
- P32 J/K/I suites green: passenger-detail/class/train/date/route changes invalidate an
  existing review; stale review cannot confirm; stale fare/availability blocks review;
  failed lookups invalidate nothing (P32 §10 fix preserved).
- New: superseded search results never supply review times (unit-proven).
- Confirm flow still revalidates server-side; conversational "haan/confirm" remains
  powerless (no confirm tool exists; P32 N green).

## 6. Provider authorization & approval boundary
No booking provider exists or was enabled. Valid explicit approval ends at
`IRCTC_HANDOFF_READY` with the explicit "Actual booking execution is not enabled; no
ticket has been issued" banner (e2e asserted). No endpoint invented, no provider called,
no fake success/PNR possible.

## 7. Test commands & actual results
| Command | Result |
|---|---|
| `npx vitest run tests/unit/prompt33-review.test.ts tests/unit/p31-preparation.test.ts tests/unit/p32-acceptance.test.ts` | **34 passed** |
| `npx vitest run` (full unit) | **355 passed / 6 skipped** (6 = LIVE-gated live-verify; intended) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 2 errors — both pre-existing `react-hooks/set-state-in-effect` in `src/app/review/page.tsx` (P36-era, same pattern; no new issues introduced by this milestone) |
| `npx next build` | ✓ compiled successfully |
| `npx playwright test` (full e2e) | **245 passed** (incl. updated review specs) |

Prompt §7 mapping: A ✓(e2e review-1), B/C ✓(e2e review-2 + P32 A/B), D ✓(P32 C + e2e
form), E ✓(P32 D), F ✓(P32 field matrix both sides), G ✓(P32 F/G), H ✓(P32 I), I/J ✓(P32
J/K + new superseded-times unit), K ✓(P32 N), L ✓(e2e handoff + P32 M), M/N ✓(P32 R +
handoff banner), O ✓(voice suite shares pipeline), P ✓(conversation-qa/multiturn green),
Q ✓(P29 age-only suites green, code unchanged).

## 8. Limitations / remaining blockers
- Dep/arr appear only when the provider row carries them (by design — never invented).
- "Booking request accepted" state is not reachable (no authorized booking provider);
  the pill's terminal state is honestly "Preparation complete — booking provider
  unavailable".
- Pre-existing lint pair in `review/page.tsx` remains (out of this milestone's scope;
  fixing would refactor the page's data-loading effects).

## 9. Commit / deployment status
- Local commit created (hash recorded in git log as the HEAD of `main`).
- **No push, no deployment, no production change, no real booking** occurred.
