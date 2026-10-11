# Prompt 30 — End-to-End Booking Preparation, Train/Class Selection & Verified Final Review
## Report

Date: 2026-10-11 · Baseline: `main` @ `a43b247` (P29), working tree clean at start. P27/P28/P29 reports present and their implementations verified in code before any change (age-only boundary at orchestrator L330, `UpdatePassengerArgs` superRefine, `recoveryUsed` single-shot guard).

> This milestone ends at a verified final review. Real booking execution, ticket issuance, payment, transactional cancellation, IRCTC login, OTP and CAPTCHA remain disabled. No push, deploy, or production change in this milestone.

---

## 1. Files changed and rationale

| File | Change | Why |
|---|---|---|
| `src/components/PassengerFormPanel.tsx` | Added a **"Journey review"** block (existing component, existing design tokens): train number + name, journey date, route (from → to), class, and per-passenger completion status computed from the authoritative state — "Passenger N complete" or "missing: \<exact fields\>"; a readiness line appears only when every required field is saved, stating review-only/booking-disabled. Header line now also shows the route. | Requirement §3: user must review the journey + actually-saved passenger data before any booking execution. Nothing fabricated: every value comes from `SelectionState`/`PassengerDraft` delivered by the validated `passenger_form` event; fare/availability are shown nowhere because the selection state carries none — omitted rather than invented. |
| `tests/e2e/passenger-form.spec.ts` | New fixture e2e test: review shows authoritative selection data; incomplete passenger → exact missing fields and NO readiness marker; complete passenger → honest readiness + "booking execution is disabled". | Requirements §3/§7 (I, J, N). |
| `tests/unit/p30-journey.test.ts` | NEW — 3 deterministic tests: position/name-based selection against current results; stale-selection rejection after a journey/date change with a different provider result set (+ supersede clears selection/passengers); provider failure yields zero cards and no availability claim. | Requirements §7 (B, C, K, L). |
| `scripts/live-selection.mjs` | Added **L8**: final review readiness — the authoritative form event must carry train + date + class + all required passenger fields saved. | The required "complete booking once till the final review" live run. |

No orchestrator, tool, schema, prompt, model/provider, guard, or recovery change in this milestone (verified by the diff scope above).

## 2. Verified end-to-end flow

Deterministic (mocked) + one bounded live run with real LLM and providers:

**Live run — 10/10 PASS** (`scripts/live-selection.mjs`, single run, no reruns):
1. Natural Hinglish journey request → live provider search (train 11906 HSX AGC EXP, Ludhiana → Delhi).
2. Train selected conversationally; class 2A validated against provider classes (2A,3A,3E,SL) → passenger form opened automatically.
3. Name collected and validated → age turn: the model omitted the tool call (8th occurrence); the P26 guard blocked the false claim; the **age-only recovery fired exactly once**; the model called `UPDATE_PASSENGER` and the value saved (server log shows the full chain).
4. Gender collected → assistant itself summarized **"Passenger 1 complete"** — no re-ask of already-saved fields at any point.
5. **L8: final review data complete** — authoritative form event carried `sel=11906/2A/2026-10-12` + `{name, age:28, gender:"male"}` — exactly what the Journey review block renders.
6. Natural correction overwrote name only (age+gender retained); food honestly refused with no invented option.

## 3. Test coverage map (A–O)

| Req | Coverage | Result |
|---|---|---|
| A unambiguous selection by number/name | p30-journey + P25 selection tests | PASS |
| B position-based = current results | p30-journey A/B test | PASS |
| C ambiguous/outdated → clarification/rejection | p30-journey C/K test (stale train rejected; prompt requires clarification on multi-match, verified P25) | PASS |
| D valid train+class opens the form | P25 suite + e2e + live L3 | PASS |
| E text & voice → same validated state | P25/P26 suites (single orchestrator path; voice = same SSE) | PASS |
| F saved fields not re-asked | P27 Case C (context shows saved/missing) + live run | PASS |
| G age-only recovery boundary | P29 F/G/H tests re-run | PASS |
| H invalid values (numeric/string age edges) | P29 C/D/M2 | PASS |
| I review reflects authoritative state | new e2e test | PASS |
| J missing fields identified, no fabricated completion | new e2e test ("missing: age, gender", no readiness) | PASS |
| K journey/date change blocks incompatible reuse | p30-journey C/K + P25 supersede test | PASS |
| L provider failure ≠ false availability/success | p30-journey L + existing provider-failure suites | PASS |
| M general Q&A/unrelated tools unaffected | full unit suite + P29 H | PASS |
| N booking/payment disabled | e2e asserts "booking execution is disabled"; no booking endpoint exists (no route added; UI review-only) | PASS |
| O text/voice consistent, no duplicate messages | P28 J (one message event per turn) | PASS |

## 4. Gate results vs baseline (a43b247: 274 unit / 190 e2e)

| Check | Result |
|---|---|
| `npx vitest run` | **277 passed** (274 + 3 new), 6 skipped (the intended env-gated `live-verify` file — same as baseline; one run transiently showed 7 skipped, clean on immediate re-run) |
| `npx playwright test` (4 viewports) | **195/195** (190 + 5 new review-panel tests) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 0 warnings |
| `npx next build` | clean (fresh BUILD_ID verified after sandbox wiped node_modules; dependencies restored via npm install) |
| Live (one bounded run) | **10/10** |

No pre-existing failures; no assertion weakened anywhere.

## 5. Confirmations

- **Age-only safety net unchanged:** eligibility still requires blocked **age** claim + form open + age authoritatively missing + single `recoveryUsed` shot; name/gender/berth/other tools/general conversation cannot trigger it (P29 suites re-run green; live log shows the chain only for age).
- **AI unchanged:** model/provider/settings, prompts, AI understanding, tool schemas, tool-selection and tool-calling behaviour — zero diffs; no phrase-matching router added (selection understanding remains the LLM's, validated by the backend).
- **Data honesty:** stale search results are superseded and cannot satisfy selection; provider failure yields no cards/availability; review shows only authoritative state; nothing fabricated.
- **Booking/payment remain disabled:** milestone ends at review; no booking provider enabled, no fake PNR/confirmation possible; UI explicitly labels review-only.
- **No push/deploy/production change** in this milestone (the earlier one-time push/deploy was a separate explicit owner instruction at `a43b247`; this milestone's changes are local only).

## 6. Remaining blockers / recommended next milestone

- None blocking. The model still occasionally omits the age tool call (8 live observations) — fully mitigated by guard + age-only recovery; the same omission on other fields falls back to an honest re-ask (by design boundary).
- Recommended next milestone (P31, not started): real booking **capability discovery** — verify an authorized provider's actual booking/confirmation/payment APIs and terms, then design a booking execution milestone with explicit owner approval; until then, review remains the terminal state.
