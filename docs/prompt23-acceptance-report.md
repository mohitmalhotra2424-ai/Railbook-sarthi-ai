# Prompt 23 — Real-World Conversation Acceptance, Voice-to-UI Consistency & End-to-End Validation

Date: 2026-10-11 · Branch: `main` · Baseline commit: `7c396c5` (tree clean) · Scope: audit-and-remediation only.

## A. Baseline

- Git: `main` @ `7c396c5`, zero uncommitted changes before work; no resets or deletions.
- Voice implementation (audited, `src/components/voice/*`): tap-to-talk input via the
  browser Web Speech Recognition API (final transcripts only, transcript lands in the
  composer for review — **never auto-submitted**); TTS via `speechSynthesis` for speak
  buttons / conversation mode. No server STT, no credentials, no audio stored.
  Unsupported browsers hide voice controls; text remains fully functional.
- Providers available: ConfirmTkt (keyless-public), eRail (keyless), web-data-v1;
  RailYatri live-status (live v3) present; RailYatri seat user-id absent; no PNR provider.
- LLM: NVIDIA primary + configured fallback (`.env.local`), unchanged.
- Baseline gates before edits: tsc/lint/build PASS; vitest 218 passed + 6 live-gated
  skipped; Playwright 155/155.

## B. Conversation Acceptance (Phase 2) — LIVE PASS

Executed `BASE=http://127.0.0.1:3100 node scripts/live-conversation.mjs` against a local
server with **real LLM + real providers** (`RAILWAY_PROVIDER_IDS=confirmtkt-v1,erail-v1,web-data-v1`).
Result: **9/9 live checks passed** (each backed by a real provider/LLM exchange):

| # | Scenario | Result |
|---|----------|--------|
| A1 | "Kal Ludhiana se Delhi…" → real train numbers | LIVE PASS |
| A2 | "Inmein sabse jaldi…" resolves against own results, route not re-asked | LIVE PASS |
| A3 | "Uska 3A fare…" → GET_FARE for the contextual train | LIVE PASS |
| A4 | "Seat bhi check kar do" → CHECK_AVAILABILITY reusing train+route+class | LIVE PASS |
| E1 | Date change → fresh CHECK_AVAILABILITY for new date (old data not reused) | LIVE PASS |
| B1 | "Mujhe Jammu jaana hai" → concise clarification, **no blind tool call, no invented train** | LIVE PASS |
| C1 | RAC vs WL → answered via GENERAL_RAILWAY_ANSWER, **zero provider calls** | LIVE PASS |
| D1 | English switch mid-Hindi conversation keeps journey context | LIVE PASS |

Offline regression coverage retained: `tests/unit/{conversation-e2e,conversation-qa,multiturn,
concurrency-isolation,load-resilience}.test.ts` (all passing) cover context retention,
superseded journeys, rapid follow-ups and isolation deterministically.

## C. Voice Acceptance (Phase 3)

- **Integration logic — OFFLINE PASS** (test doubles, clearly labelled as such):
  `tests/e2e/voice.spec.ts` (9 tests: transcript-to-composer, edit-before-send, permission
  denial honesty, network failure recovery, TTS plays the ACTUAL reply, TTS failure
  graceful, duplicate submission blocked, conversation mode) + **new**
  `tests/e2e/p23-acceptance.spec.ts` voice test: spoken correction
  "Nahi, Delhi nahi. / Amritsar jaana hai." lands in the composer for review, **zero
  requests before Send, exactly one assistant request after Send**.
- **Real microphone / live STT / real TTS audio — BLOCKED** in this headless environment
  (no mic hardware, no external speech service). Not claimed as live verification.
- Voice and text share the same `/api/assistant` turn pipeline; recognition uncertainty
  can never confirm a train/class (review-before-send + LLM grounding rules).

## D. Railway Data Integrity (Phases 4–5)

- Live run used real providers (see B); every card/detail field renders only
  provider-returned values; missing fields show "—", never invented.
- Freshness: `FreshnessPill` renders the exact mandated warning
  "Provider timestamp unavailable — freshness cannot be verified." whenever a provider
  returns no timestamp (component-verified; P16 card-provenance e2e retained).
- Turn-metric logs (P20) captured during the live run show per-turn
  `durationMs/toolResults/toolErrors/llmErrors/usedFallback/outcome` — LLM turns
  3.7–38.8 s, provider-backed turns honest, no fabricated successes.
- Failure handling (429/500/timeout/malformed/empty) covered by existing unit tests
  (`llm/client.test.ts`, `orchestrator.test.ts`, provider adapter tests) — OFFLINE PASS.

## E. UI Acceptance (Phase 6)

- New `tests/e2e/p23-acceptance.spec.ts`: home+chat at **360×800, 390×844, 412×915,
  1440×900** — zero console/page errors, zero horizontal overflow. **180/180 Playwright
  pass** (155 baseline + 25 new) after the fix below.
- **Defect found & fixed (regression from my P15 tab bar):** the bottom-bar "PNR" tab
  linked to `/pnr`, which has no index page (only `/pnr/[pnr]`) → RSC prefetch 404 and a
  dead tab. Fixed: tab now links to the real supported PNR flow
  (`/chat?q=PNR%20status%20check%20karna%20hai`), same target the PNR feature card uses.
- Environment note (documented, not a product defect): running the full e2e while the
  manual :3100 live server (with LLM creds) is up makes Playwright reuse it and breaks
  credential-less expectations — the live server must be stopped before the suite.

## F. Engineering Evidence

- Commands: `npx tsc --noEmit` PASS · `npm run lint` PASS · `npx next build` PASS ·
  `npx vitest run` → 218 passed + 6 skipped · `npx playwright test` → **180/180** ·
  `node scripts/live-conversation.mjs` → **9/9 LIVE**.
- Files changed:
  - `src/app/page.tsx` — PNR tab href → existing PNR chat intent (defect fix).
  - `tests/e2e/p23-acceptance.spec.ts` — NEW: voice correction-to-composer single-send
    test + console/overflow acceptance at the four mandated viewports.
- Pre-existing failures: none at baseline. New regressions introduced this prompt: none.

## G. Final Status

**PARTIAL PASS** — all core acceptance criteria verified (multi-turn live conversations,
context/reference resolution, honest clarification, general-knowledge tool discipline,
date-change freshness, voice-to-text pipeline consistency, UI acceptance at four
viewports, booking/payment boundaries intact, no push/deploy performed). The only
unverified surface is real speech hardware/services (microphone, live STT, audible TTS),
which is environment-blocked and reported as BLOCKED, not PASS.

### Top three remaining actions
1. **PNR provider onboarding** — PNR status remains chat-intent only; no authorised
   provider exists (blocked on credentials/authorization).
2. **Real-device voice validation** — run the voice e2e on physical Android Chrome with a
   working mic to convert the BLOCKED voice-hardware items to verified.
3. **RailYatri seat-enquiry user-id** — supply the owner user-id env to unlock seat
   availability from that source (currently ConfirmTkt-only).
