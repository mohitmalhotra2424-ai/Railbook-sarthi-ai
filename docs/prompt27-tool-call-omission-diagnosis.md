# Prompt 27 — Residual Tool-Call Omission: Evidence-Based Diagnosis
## Report

Date: 2026-10-11 · Scope: `railsaarthi-ai/` · **Diagnosis-only milestone — no AI behaviour, prompt, tool, orchestration or model change was made. The proposed remediation (Section F) is NOT implemented and awaits separate approval.**

---

## A. Baseline verification

| Item | Verified value |
|---|---|
| Branch / HEAD | `main` @ `eb875e5` ("P26: verified save-claim guard…"), working tree clean at start |
| P26 commit contents | `git show --stat eb875e5` confirms guard, orchestrator hook, tests A–J, report |
| P25/P26 reports | Present (`docs/prompt25-acceptance-report.md`, `docs/prompt26-save-claim-guard-report.md`); claims re-verified against code, not assumed |
| Relevant existing tests re-run | `save-claim-guard` + `passenger-selection` + `orchestrator` + `multiturn` → **34/34 pass** (matches reports) |
| Full suite after diagnostic additions | **248 passed**, 6 skipped (32 files); tsc clean; lint 0 problems; `next build` clean |

Only code changes in this milestone (both diagnostic, non-behavioural):
1. `src/assistant/orchestrator.ts` — one sanitized structured log line (`LLM response shape`: provider, finishReason, toolCallCount, contentChars — **no content, no PII, no secrets**). It exists to distinguish "model chose text" from "provider dropped a tool call"; previously unobservable.
2. `tests/unit/p27-diagnosis.test.ts` — new deterministic diagnosis tests (Cases A–G + wire-level).

## B. Execution trace (actual code path for "Age 28.")

```
User "Age 28." → POST /api/assistant → runTurn()
  beginTurn → messages = [SYSTEM_PROMPT, contextBlock, history…, user msg]
    contextBlock contains: SELECTION & PASSENGER FORM (train/class),
    PASSENGERS: "P1: name=Rahul Sharma MISSING: age,gender", RECENT TOOL RESULTS
  loop iteration 1 → client.chat({messages, tools: 12 defs incl. UPDATE_PASSENGER, tool_choice:"auto"})
  ── DIVERGENCE POINT (live, turn t-0320aa94): provider returned
     finishReason="stop", toolCallCount=0, contentChars=39, HTTP 200,
     llmErrors=0, usedFallback=false  → a normal assistant text answer
  → direct-answer branch → P26 save-claim guard → unsupported claim replaced
  → message event → user sees honest fallback; form unchanged (correct)
Expected instead: finishReason="tool_calls" with UPDATE_PASSENGER{field:"age",value:"28"}
```

The earliest stage where behaviour diverges from expectation is **the provider's response itself** — every application stage before it is verified correct (Section C), and every stage after it (guard, state protection) behaved exactly as designed.

## C. Evidence-backed root cause

| # | Suspected cause | Verdict | Evidence |
|---|---|---|---|
| 1 | Request lacks passenger-form context | **Ruled out** | Deterministic capture (Case A): `messages[1]` contains `name=Rahul Sharma`, `MISSING: age,gender`, `class=3A`; user message last (ordering intact) |
| 2 | Tool schema/description missing or inconsistent | **Ruled out** | Request carried all 12 tools incl. UPDATE_PASSENGER (wire test + Case A); the same definition was called successfully in the same live sessions (L4, L6, L7) |
| 3 | Tool-choice permits plain text | **Confirmed as a design condition, not a defect** | Wire test: body carries `tool_choice:"auto"`. Changing it is prohibited in this milestone and is analysed in Section F |
| 4 | Context stale/incorrectly assembled | **Ruled out** | Context is rebuilt per turn and refreshed in-turn after tool results (observed in Case A: post-update context showed `age=28 MISSING: gender`) |
| 5 | History mis-ordered/truncated/excluded | **Ruled out for this scenario** | MAX_MESSAGES=16 vs ~12 messages in the live flow; ordering asserted in Case A. (History stores user/assistant text only; tool evidence travels via the context block — by design, verified present) |
| 6 | **Provider returns a normal assistant message without a tool call** | **CONFIRMED — root cause** | Live diagnostic: failing turn logged `finishReason:"stop", toolCallCount:0, contentChars:39` with HTTP 200, no errors, no fallback. Reproduced 6/6 live runs (P25 ×4, P26 ×1, P27 ×1), always on the bare age-answer turn, never on name/correction/food turns of the same sessions |
| 7 | Provider errors/timeouts/fallback interference | **Ruled out for the failing turns** | Failing turns: `llmErrors:0, usedFallback:false`. (HTTP 500/404s occurred on OTHER turns in the same runs and were handled honestly by the existing retry/fallback path) |
| 8 | Valid tool call lost/rejected downstream | **Ruled out** | Client parses standard `choices[0].message.tool_calls` (wire test passes); the failing response had `finish_reason:"stop"` — there was no tool call to lose. Edge case documented: `finish_reason:"tool_calls"` + empty array would degrade to a plain-text turn (wire test) — not what occurred |
| 9 | App misclassifies the message as conversational | **Ruled out** | No intent classification exists anywhere in the codebase (LLM-first by design); the message reaches the provider verbatim |
| 10 | Other | None found | — |

**Root cause:** the configured model (`meta/muse-glimmer-30b` via NVIDIA) elects a plain-text answer — including a false "saved" claim — instead of emitting the `UPDATE_PASSENGER` call, specifically for short bare-value answers ("Age 28.") mid-form. The application correctly supplies the tool, the context and the ordering; the omission happens inside the model's generation. The P26 guard then correctly prevents the false claim from reaching the user.

## D. Reproduction results (Cases A–G)

Deterministic (`tests/unit/p27-diagnosis.test.ts`, **11/11 pass** — scripted clients/mocked transport, clearly labelled test doubles):

| Case | What was exercised | Result |
|---|---|---|
| A | "Age 28." turn with request capture | Tool + full context verified present; compliant model's call dispatched; state `{name, age:28}` |
| B | "Age 28 save kar do." | Same tool requested/dispatched, `ok` |
| C | Name stored, user says "28" | Context shows name present / age missing (no re-ask); bare "28" recorded as age |
| D | Age 280 | `invalid_arguments`; form unchanged |
| E | **Recorded sanitized live failure shape** (plain text, `toolResults:0`, verbatim P25/P26 text) | P26 guard blocks the false claim; honest fallback delivered; form unchanged |
| F | Genuine tool success | Authoritative field updated correctly |
| G | Provider timeout (mock) | Honest `LLM_TIMEOUT` error event; nothing delivered; form unchanged |
| wire ×4 | tools+`tool_choice:"auto"` on body; standard tool_calls parse; empty-array edge; malformed payload → error | All pass |

Live (one bounded run, no green-chasing): failure reproduced on L5; new check **L5G PASS** (no unsupported claim delivered); log evidence in Section B/C. Mock vs recorded vs live evidence distinguished above.

## E. Impact and scope

Evidence limits the impact to **passenger-field update turns with short bare-value answers**. All 6 live reproductions occurred on the "Age 28." turn; the same sessions' name, correction, food and selection turns always produced correct tool calls, as did all search/availability/fare/PNR tool usage across P23's 9 live conversations and these runs. **No evidence** of omission in other tool-calling scenarios; not generalizing beyond that. User impact today is bounded by P26: no false confirmation reaches text or voice, and the form's missing-field indicator stays truthful — but the supplied value is not recorded until the user repeats it.

## F. Smallest safe remediation (PROPOSED — NOT implemented; requires approval)

**Recommended — Option 1: bounded single re-ask on a guard-detected false save claim.**

| Aspect | Detail |
|---|---|
| File/component | `src/assistant/orchestrator.ts` only (direct-answer branch, where the P26 guard already runs) |
| Mechanism | If `guardSaveClaims` blocked a claim for a field the authoritative state still lists as MISSING, make ONE additional LLM request in the same turn appending a short system message ("You stated a passenger detail was saved without calling UPDATE_PASSENGER. Call it now or ask the user to repeat."), then continue the existing loop; the second response passes through the same validation/guard path. Cap: 1 re-ask per turn; second failure → the honest P26 fallback is delivered as today |
| Why necessary | It converts the confirmed model omission into a corrected action using the model itself — no keyword router, no hardcoded age/name detection, no second engine, no state mutation from text. Detection reuses the guard's existing evidence, so it triggers only on an already-proven defect |
| Expected behaviour change | On affected turns only: one extra LLM call (~2–25 s observed latency) and, in the expected case, the age actually gets recorded and truthfully confirmed. All other turns byte-identical |
| Regression risk | Low-moderate: extra latency on affected turns; risk the second response also omits (bounded by the cap); must not loop (cap + existing MAX_TOOL_ITERATIONS). No change to tools, schemas, tool_choice, prompts, model, retry policy or validation |
| Tests needed | Scripted-client unit tests (claim → re-ask → tool call → truthful confirm; claim → re-ask → still no call → honest fallback, exactly one retry); full existing suites; one bounded live check |
| Why less invasive options are insufficient | The P26 guard (already in place) protects truthfulness but never records the value; prompt hardening was tried twice in P25 and the model still recurred 6/6 |

**Rejected alternatives (documented for the decision):**
- **Option 2 — `tool_choice:"required"` while the form has missing fields:** one-line change, but forces a tool call on EVERY form-phase turn, breaking legitimate conversation (questions about the train, corrections, etc.); endpoint support unverified. Higher regression risk than Option 1.
- **Option 3 — different/stronger model:** outside this milestone's authority; biggest behavioural change; requires separate approval per standing constraint.
- **Option 4 — further prompt-only hardening:** already attempted twice (P25) with no effect on this turn shape; evidence says insufficient alone.

## G. Final classification

**DIAGNOSIS COMPLETE** — root cause established with direct evidence: provider response `finishReason:"stop", toolCallCount:0` on a 200/ok/no-fallback turn, with every application stage (tool availability, context, ordering, parsing, dispatch, validation, state, guard) verified correct by deterministic tests. Reproduced 6/6 live; blocked-from-user 6/6 by the P26 guard.

### Safety confirmations
- Passenger validation intact (Case D + full suite); P26 guard functional (Case E, L5G, 248-test suite).
- No unsupported confirmation reached the user in any run.
- No existing assertion weakened; no booking/payment/cancellation/ticket/IRCTC/OTP/CAPTCHA enabled or executed.
- No production configuration or service touched; nothing pushed or deployed; live server stopped after the single run.
- No AI prompt, model setting, tool definition, tool-calling behaviour or orchestration logic changed. Prompt 28 not started; the Section F remediation awaits explicit approval.
