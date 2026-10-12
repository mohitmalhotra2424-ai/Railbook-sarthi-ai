# Prompt 35 — Natural Conversational Voice Brain — Report

**Scope:** voice-experience layer ONLY (recognition / transport / pronunciation /
presentation). The AI brain — LLM provider, prompts, tool schemas, dispatch,
session handling, reasoning — is untouched. No second orchestrator, no scripted
engine, no keyword intent routing, no second LLM polishing call, no
always-on recording, no mic-privacy changes, no booking/payment execution.

---

## 1. Audit — defects found, before → after

| # | Defect (before) | Fix (after) |
|---|---|---|
| 1 | **Unnatural readout of presentation artifacts.** `speakableText` only removed markdown marks; links were read as raw `[label](url)` text, `→`/`->` were dropped or glyphed, `₹` was skipped, bullets `• ·` were dropped. | Links reduced to their visible label; `→`/`->` spoken as " se "; `₹` spoken as " rupees "; bullets become commas. Facts (train numbers, times, fares, names, statuses) are preserved verbatim — unit-tested. |
| 2 | **No sentence segmentation in browser fallback.** The entire reply (up to 1200 chars) was handed to `speechSynthesis` as ONE utterance — some engines truncate or stall on very long text, and pauses land mid-sentence. | New `spokenSentences()` splits text at sentence boundaries (merging up to ~220 chars) and `useSpeak` queues the chunks **sequentially**: next sentence starts only when the previous ends. Order and content preserved exactly. |
| 3 | **Duplicate / out-of-order audio risk across turns.** A stop or a newer turn could race older utterances. | Every chunk handler is generation-guarded (`genRef`): once a turn is superseded or stopped, its chain cannot resume, so remaining chunks are discarded — no orphaned or duplicate audio. Covered by a deterministic e2e test (stop mid-chain → chunk 3 never spoken). |
| 4 | **Speech continued after a text interrupt.** Typing/sending a new message did not stop playback of the previous answer. | `send()` now calls `speak.stop()` after the input guards — playback stops promptly on barge-in; the obsolete audio element cannot resurrect state (e2e-verified with a pause-tracking fake `Audio`). |
| 5 | **Avoidable delay.** — | No new delay introduced: the server-TTS path (Prompt 34) is unchanged and still first; the chunked fallback runs only when the server path fails. **No second LLM call** anywhere — speech text is the already-generated assistant reply, lightly cleaned. |

**STT (`useVoiceInput.ts`):** audited and found already correct — tap-to-talk,
final transcripts only (never auto-submits), honest denied / no-speech / error
states, no interim leakage. **No changes needed; none made.**

## 2. Files changed and why

| File | Change |
|---|---|
| `src/components/voice/lang.ts` | Extended `speakableText` (links, arrows, currency, bullets — artifacts→words, facts intact); added `spokenSentences()` sentence chunker. Pure functions, unit-testable. |
| `src/components/voice/speechSummary.ts` | **New.** `speechSummary` moved out of `ChatClient` (same logic) so the spoken-summary construction is unit-testable; still built ONLY from verified card/block data with the honest `KIND_LABEL` categories. |
| `src/components/voice/useSpeak.ts` | Browser-fallback path now plays `spokenSentences` chunks sequentially, each handler generation-guarded; keeps the conditional `cancel()` + 120 ms defer (Chrome swallows `speak()` right after `cancel()`). Server-first path, stop semantics and public API unchanged. |
| `src/components/ChatClient.tsx` | Imports the moved `speechSummary` (local copy deleted, unused status imports removed); `send()` calls `speak.stop()` for text barge-in. No pipeline/session changes. |
| `tests/unit/voice-natural.test.ts` | **New** — 15 unit tests (artifact cleaning + fact preservation, language detection, chunking, speech-summary honesty). |
| `tests/e2e/voice-natural.spec.ts` | **New** — 3 specs × 5 projects (chunk order/no-duplicates, stop mid-chain, text barge-in). Test doubles only. |

**AI-brain confirmation:** `git diff` touches only the four voice-layer files
above; `src/assistant/**` (orchestrator, prompts, tools, schemas, dispatch,
session) has **zero changes**. Railway tools, the P28/P29 age-only safeguard,
tap-to-talk, conversation mode and all honest-fallback behaviour are preserved.

## 3. STT / TTS configuration changes

**None.** No provider switched, no paid service added, no dependencies added,
no env/secret changes. Server TTS (Prompt 34) config and the browser
`speechSynthesis` fallback both remain exactly as they were.

## 4. Languages & switching

Voice selection is per-utterance: any Devanagari → `hi-IN`, otherwise `en-IN`
(model/TTS-capability based, **no hardcoded phrase rules**). Mid-conversation
switching therefore works by construction — every reply's language is detected
from that reply alone. Unit-tested for Hindi (Devanagari), Hinglish (Latin),
English and mixed text. Pronunciation quality is bounded by the configured
TTS voice (`hi-IN-SwaraNeural` on the server path; the user's installed
`hi-IN`/`en-IN` voices in fallback) — we speak the actual reply text only,
never an invented or rewritten answer.

## 5. Verification

Commands (all run locally, this session):

```
npx tsc --noEmit          → clean
npm run lint              → only 2 PRE-EXISTING errors (see below); 0 new
npx vitest run            → 326 passed, 6 skipped (was 311 + 15 new)
npx playwright test       → 245 passed (was 230 + 15 new)
```

Pre-existing lint note: `src/app/review/page.tsx` has 2
`react-hooks/set-state-in-effect` errors that **already existed at HEAD before
this change** (verified via `git stash` + re-lint). They belong to the earlier
review-page feature, not the voice layer, and were left untouched per the
"no unrelated changes" constraint.

Coverage against the acceptance list: language inputs & switching (unit +
live runs), same session/pipeline for voice & text (unchanged `send()` path),
tool semantics unchanged (zero assistant diffs), no fact invention in speech
(unit tests over card/block summaries incl. unknown-status honesty),
interrupt/barge-in + obsolete-turn discard + duplicate-submit guards (e2e),
honest fallback states (existing voice.spec + server-tts.spec still green),
tap-to-talk intact, passenger/fare/review flows untouched, no booking
execution, no extra LLM call.

## 6. Latency (measurable parts only)

- **Server TTS path: unchanged code path.** Measured on the live service after
  deploy (POST `/api/voice/speech`, 3 phrases): see numbers in §7 below.
- **STT latency:** not measurable headless (no microphone); recognition
  behaviour itself is unchanged.
- **Browser-fallback chunking:** audio timing is not measurable headless;
  correctness (order, no duplicates, discard-on-stop) is covered
  deterministically by the new e2e tests instead.

## 7. Live verification (post-deploy)

Deploy `dep-db67qa4s728c73fg4h60` → **live @ 90ea34b** on
https://railsaarthi-ai.onrender.com.

- `GET /api/health` → ok; LLM primary (`meta/muse-glimmer-30b`) + fallback
  (`openai/gpt-oss-20b`) configured; booking disabled.
- `GET /api/voice/speech` → `{"configured":true}`.
- **TTS latency, warm (POST `/api/voice/speech`, 3 phrases):**
  Hindi 1.72 s (19,584 B) · Hinglish 2.49 s (25,488 B) · English 1.47 s
  (24,624 B) — all `audio/mpeg`, valid MP3 headers (`ff f3 …`). Server code
  path unchanged from Prompt 34; these are the current baseline samples.
  During Render free-tier spin-up the upstream briefly answered 502 — the
  client then falls back to browser speech (honest fallback, e2e-covered);
  no error was shown as success.
- **Live 5-turn language run** (same conversation, `scripts/p35-live-run.py`):
  Hindi Devanagari search → Hindi follow-up → English fare question → mixed
  script availability question → Hinglish booking request. All turns:
  errors=0, non-empty replies, context preserved across language switching
  (same `conversationId`), the "no published fare" case answered honestly
  without inventing numbers, and the booking request performed only
  train selection — **no booking/payment executed** (as designed).

## 8. Limitations

- Browser-fallback naturalness is bounded by the voices installed on the
  user's device; the server path remains the primary.
- Sentence chunking improves pauses but cannot add true prosody — that is a
  TTS-engine property.
- STT accuracy/latency depend on the browser's recognition service and were
  not re-measured here.

## 9. Commit

- Code + tests: `90ea34b` (pushed, deployed live)
- This report: the docs commit immediately following `90ea34b` on `main`
