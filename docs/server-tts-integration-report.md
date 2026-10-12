# Server TTS Configuration Addendum — Integration Report

Date: 2026-10-12 · Baseline: `main` @ `d836ba6`, working tree clean except pre-existing untracked probe screenshots (preserved).

## 1. Inspection findings (before changing)

- **Existing TTS:** client-side `window.speechSynthesis` only (`useSpeak.ts`); the server generated **no** audio before this addendum. STT is browser `SpeechRecognition` via `useVoiceInput`.
- **Env conventions:** server-only env read at call time, mirroring `LLM_*` pattern (`src/assistant/llm/config.ts`). The five `VOICE_TTS_*` values follow the same convention.
- **Endpoint contract verified (real requests, dummy + owner-provided key):**
  - `GET /v1/models` → 200 `{"models":[{"id":"tts-1"},{"id":"tts-1-hd"},{"id":"gpt-4o-mini-tts"}]}` — OpenAI-compatible.
  - `POST /v1/audio/speech` with dummy key → `401 {"error":"Invalid API key"}` — auth required, OpenAI error shape.
  - With the configured key: `200`, `content-type: audio/mpeg`, valid MP3 bytes (`ff f3 … LAME` header) for Hindi, Hinglish and English synthetic phrases; **`hi-IN-SwaraNeural` accepted and used** (voice sent in the verified request body).
- No adapter was needed: the endpoint implements the OpenAI speech contract the integration uses.

## 2. Implementation (scoped)

| File | Change |
|---|---|
| `src/assistant/voice/tts-config.ts` | NEW — reads the five `VOICE_TTS_*` env values server-side; null (honest not-configured) when incomplete |
| `src/assistant/voice/tts.ts` | NEW — `synthesizeSpeech()`: POST `${base}/audio/speech` with configured model+voice; 20s timeout; honest failure codes (auth/http/timeout/invalid_audio); never logs the key |
| `src/app/api/voice/speech/route.ts` | NEW — `GET` capability probe (`{configured}` only); `POST {text}` → raw audio or 503/502/400; credential never in responses |
| `src/components/voice/useSpeak.ts` | server-first playback of the SAME cleaned assistant text; browser speechSynthesis fallback on any server failure; generation counter aborts obsolete fetches so stale audio can never overtake a newer turn; single in-flight request (no duplicates) |

Unchanged: LLM/provider/model, prompts, tool schemas/dispatch, railway providers, passenger/booking logic, text chat, mic/recording privacy. No second LLM call — TTS speaks the existing assistant response only.

## 3. Verification results (actual)

| Check | Result |
|---|---|
| Server reads intended config | `GET /api/voice/speech` → `{"configured":true}` with env injected; `false`/503 without |
| Endpoint accepts configured request, returns playable audio | Hindi 200 `audio/mpeg` 29,376 B; Hinglish 200 / 23,184 B; English 200 / 17,280 B (valid MP3 magic bytes) |
| `hi-IN-SwaraNeural` accepted/used | 200 with the voice in the request; dummy key 401 |
| Audio matches assistant response | client sends exactly `speakableText(message)`; e2e asserts POST body contains the fixture reply and the played audio is that turn's |
| Invalid creds / errors / timeouts fail safely | unit: 401→auth, 500→http, non-audio/empty→invalid_audio, AbortError→timeout, unset→not_configured; e2e: 503→browser fallback speaks; slow upstream + stop → obsolete audio never plays |
| No credential in frontend/logs/commits | grep over src/tests/docs/.next/static = 0; server log occurrences = 0; key used only via process env, never printed (outputs show status/size only) |
| Regressions | unit **311 passed / 6 skipped**; e2e **230 passed**; `tsc`/`lint`/`next build` clean (P32 R-test API-surface list updated to include the new `voice` route — same intent) |

Mocked vs live: unit/e2e use test doubles (clearly labelled); the endpoint checks above are **live** against `railbook-edge-tts.onrender.com` with the owner-provided key. Headless cannot verify audible output — byte validity + playback wiring verified instead.

## 4. Limitations

- Audible quality on real devices needs an on-device check (wiring + bytes verified here).
- Production requires the five `VOICE_TTS_*` env values on the host; without them the app honestly falls back to browser TTS.

## 5. Confirmations

- Booking/payment/OTP/CAPTCHA remain disabled; no AI/tool/booking behaviour changed.
- Report contains no credential value.
