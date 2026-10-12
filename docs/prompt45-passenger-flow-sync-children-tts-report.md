# Passenger page, synchronized fields, child travel policy and automatic speech

Local implementation following the owner's three screenshots. Date: 2026-10-12.
Baseline: local HEAD `547b9a7`. No push, deployment, environment/provider changes, or real booking.

## Findings and corrections

- The original inline PassengerFormPanel uses uncontrolled inputs (`defaultValue`). Later authoritative passenger events can update labels/state without reliably updating the visible input value. This is a concrete UI synchronization defect; screenshots alone do not prove whether the backend saved each value at that moment.
- The existing save-claim guard did not recognize the screenshot wording “नोट कर ली गई है”. The guard now recognizes noted/note/नोट variants. This prevents the tested unsupported claim; it is not a guarantee of perfect arbitrary-language claim detection.
- Existing orchestrator already emits `passenger_form` immediately after a successful SELECT_TRAIN/SELECT_CLASS/UPDATE_PASSENGER. Reused this event rather than adding an LLM call or a polling loop.
- Initial work considered broader passenger recovery; this was removed before delivery. Existing P28/P29 AGE-ONLY recovery remains unchanged. Gender/berth do not trigger a new recovery call; an unsupported confirmation is blocked honestly. The existing tool-use instruction now explicitly covers berth and “noted”.

## Implemented flow

1. Chat retains search and selection. Once train AND class exist, navigation to `/passengers?c=…` occurs after the active stream completes, not mid-tool execution.
2. Dedicated passenger page: name, completed-years age, gender dropdown, nationality metadata, passenger category, berth dropdown, add passenger / infant with berth / infant without berth.
3. The page reuses the existing ChatClient via “Fill by voice / chat”. It pins the conversation ID and disables New Chat within this form. Successful assistant save events update fields directly through a callback, with no interval polling/refetch.
4. Text drafts synchronize later server values unless the user is actively editing. Manual writes save on blur, are serialized, and retain errors. Review remains disabled for dirty/pending/failed edits, incomplete readiness or an active assistant turn. Manual fields are disabled while the embedded assistant is open to avoid simultaneous editing paths.
5. Review remains on `/review`, the next page after passenger details. It uses category-aware required fields, labels no-berth infants correctly, and links back to passenger details. Existing validated review/confirm boundary and disabled booking execution remain.

## Official child policy

Primary source fetched during this work:
https://pib.gov.in/PressReleasePage.aspx?PRID=1852502
Ministry of Railways, 17 August 2022, quoting circular 06.03.2020:
- Under five without a separate seat/berth: carried free; no ticket purchase required.
- Under five with a voluntarily requested separate seat/berth: full adult fare.

Supplementary official source for the existing warning about ages 5 to under 12:
https://www.pib.gov.in/newsite/PrintRelease.aspx?relid=138458&reg=48&lang=2
Reserved travel: full fare with separate berth; half fare without, subject to minimum charging distance.

Implementation:
- Explicit infant-with/without-berth categories; no guessed choice from age alone.
- No-berth infants require name, age, gender, but not a berth preference. With-berth infants still require a preference.
- Age 0 means completed years under one; age 4 is under five, age 5 is not. Strict integer validation rejects partial numeric strings, floats, booleans and negative ages.
- Store rejects infant category at age >=5; readiness also defends invalid persisted state.
- Switching to no-berth clears a previous berth preference and invalidates review. Switching back requires a fresh preference.
- Rule shown with official source link; no fabricated fare totals or booking confirmations.
- The earlier conversational claim “maximum 2 children per adult” was not officially verified and is NOT implemented. Child details are collected for this product's preparation flow, not represented as an independently verified legal requirement.
- Existing product limit of six passenger entries is retained, including infant entries. It is labelled as a product limit, not an IRCTC entitlement. Infants outside that cap are not implemented.
- Nationality is preparation metadata, not provider-verified identity or eligibility. No nationality-based booking/fare logic added.

## Automatic speech

Auto-suno defaults ON independently of conversation-mode microphone re-listening. New assistant replies request playback without clicking Suno. Persisted ON/OFF control and manual replay/stop remain; control is available even without microphone support.
Existing server-first neural TTS, model/voice settings, browser fallback, sentence chunking and barge-in are unchanged. No translation/polishing/classification model or additional LLM call added.

Important: automatic playback is attempted, not guaranteed on every browser. Android/iOS autoplay policy may still require a tap. Browser fallback can sound less natural than the configured server voice. Real-device subjective audio quality has NOT been verified in this work. Navigation away from a chat still cancels its audio and request lifecycle as before.

## Files

New:
- `src/app/passengers/page.tsx`
- `tests/unit/prompt45-passenger-page.test.ts`
- `tests/e2e/auto-speak.spec.ts`
- This report.

Modified:
- `src/components/ChatClient.tsx`: page routing, same-session form callback, busy callback, auto-speech toggle.
- `src/components/voice/useSpeak.ts`: documentation only; existing synthesis settings unchanged.
- `src/app/api/passenger/route.ts`: validated category on add.
- `src/assistant/context/store.ts`: category metadata, category-aware required fields/context, infant guard and review invalidation.
- `src/assistant/booking/preparation.ts`: child-specific readiness/policy warnings.
- `src/assistant/passengers/validate.ts`: age 0/strict ages, category/nationality validation.
- `src/assistant/passengers/save-claim-guard.ts`: noted/नोट confirmation recognition.
- `src/assistant/tools/schemas.ts`: category/nationality allowed through the existing UPDATE_PASSENGER tool.
- `src/assistant/prompts.ts`: one existing passenger instruction extended, not a prompt rewrite.
- `src/app/review/page.tsx`: infant display/completeness, back links.
- `tests/unit/p29-age-compat.test.ts`: age 0 removed from invalid-age fixtures (new infant requirement); malformed age cases added. AGE-ONLY recovery tests remain intact.
- `tests/e2e/passenger-form.spec.ts`: inline-form expectations adapted to the new page, plus text/voice same-event sync tests.
- `tests/e2e/server-tts.spec.ts`, `voice-natural.spec.ts`, `voice.spec.ts`: manual replay/stop tests pin autoplay OFF; default ON is tested separately, not disabled in application code.

## Verification

Final commands:
- `npx vitest run`: 414 passed, 6 skipped (live integration gate).
- `npx tsc --noEmit`: clean.
- `npm run lint`: 2 pre-existing set-state-in-effect errors in review/page.tsx; zero new errors/warnings.
- `npm run build`: success, `/passengers` present.
- `npx playwright test`: 265 passed across five configured viewports. Full suite run again against the final build.
- `git diff --check`: clean.

Browser tests use labelled API/SSE, speech-recognition and audio doubles. They verify routing, save/render wiring, review gating, auto-play without Suno, OFF persistence, same-session voice transcript submission, and name/age/gender/berth updates without remount/refetch. They do NOT prove real model interpretation, provider availability, microphone recognition quality, or audible naturalness on the owner's Android device.

Unit coverage includes the exact screenshot's unsupported “नोट” claim, truthful pass-through, category validation, 0/4/5 age boundaries, invalid-age rejection, category transitions and review invalidation, category-aware completeness and preserved entry limits.

No new live model/provider/mobile-audio run was performed. No production success is claimed. At initial delivery changes were local and uncommitted. The owner subsequently authorized pushing/deploying Prompt 45 after disclosure that its prompt, schema, guard and passenger semantics changed. Pre-existing untracked scripts/images remain preserved. Deployment results are reported separately, not assumed here.
