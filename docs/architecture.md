# RailSaarthi AI — Architecture (Phase 2: LLM-first)

## The non-negotiable core

**The LLM is the sole conversational interpreter, planner and railway-tool
orchestrator.** There is no intent-detection regex, no dialogue state machine,
no scripted replies, no fixed tool chain, and no mock model anywhere.
Deterministic code exists ONLY at technical/safety boundaries: schema
validation, tool execution, timeouts, correlation, provider-response
validation, freshness metadata, secret protection, and prevention of
unsupported factual claims.

```
User (mobile browser)
  │  POST /api/assistant  { conversationId, message }
  ▼
SSE route ──► ORCHESTRATOR (src/assistant/orchestrator.ts)
  │              │  loop ≤ 6 iterations:
  │              │   1. build messages = system prompt + CONTEXT block + pruned history
  │              │   2. LLM chat + 9 tool schemas  (OpenAI-compatible, server-side keys)
  │              │   3. model decides: answer | clarify | call tools (1..n) | explain
  │              │   4. tool calls → VALIDATE (Zod) → execute → ToolResult → back to model
  │              ▼
  │        TOOL EXECUTOR (src/assistant/tools/executor.ts)
  │              │  correlation ids, timeouts, honest status mapping
  │              ▼
  │        PROVIDER LAYER (src/providers/*)  — ResultEnvelope, reconcile, registry
  │              │  adapters: NONE authorized in Phase 2 → honest not_configured
  ▼
Events streamed to UI: status · tool_call · tool_result · message(+cards) · error
```

## Conversational decision-making (requirement 1 & 2)

The model receives, every turn:
1. **System prompt** (`prompts.ts`): language mirroring, grounding absolutes
   (live facts only from tool results; RAC/WL/REGRET are valid outcomes;
   never invent; booking disabled), tool-use guidance (resolve references,
   re-run tools after date/route changes, GENERAL_RAILWAY_ANSWER for
   knowledge questions).
2. **CONTEXT block** (`context/store.ts`): TODAY's date, journey context
   (route/date/train/class), and compact result refs `[r1] SEARCH_TRAINS
   LDH→NDLS date=… status=… items: 1) … 2) …` with explicit SUPERSEDED marks.
3. **Pruned message history** (≤16 messages; structured context carries the
   rest — history is never sent unbounded).

Everything conversational — language, clarifications, reference resolution
("doosri wali"), date correction ("parso"), whether to call a tool at all —
is the model's decision, verified live (see `scripts/smoke-live.mjs` runs in
the phase report).

## Conversation memory & turn management (requirement 3)

- Stable `conversationId` (client-generated, persisted in localStorage;
  server validates format and can issue one).
- Server-side `ConversationStore`: LRU (200 convs), TTL 2h, ≤16 messages,
  ≤8 result refs. In-memory for this phase; interface-ready for Redis/DB.
- **Invalidation:** a new SEARCH/AVAILABILITY run for a different date or
  route marks earlier refs SUPERSEDED (with reason) — the model is told not
  to use them as current.
- **Stale-turn guard:** `recordToolResult` rejects results whose turnId is
  not the conversation's current turn — a late tool result from an
  interrupted turn can never overwrite a newer correction.
- **Duplicate-call guard:** identical tool+args within one turn is answered
  from the first execution instead of re-running.

## LLM integration (requirement 4)

- Generic **OpenAI-compatible client** (`llm/client.ts`) configured by
  `LLM_PROVIDER/LLM_MODEL/LLM_API_KEY/LLM_BASE_URL` (+`LLM_TIMEOUT_MS`).
  Provider/model are replaceable with zero conversation-logic changes.
- **Primary (verified live 2026-10-10):** NVIDIA `meta/muse-glimmer-30b` via
  `https://integrate.api.nvidia.com/v1` — plain chat AND structured tool
  calling both verified with real credentials.
- **Fallback (verified live 2026-10-10):** NVIDIA `openai/gpt-oss-20b` —
  tool calling verified. Used only because it is explicitly configured, and
  every switch emits a `using_fallback` event + `viaFallback` on the message
  (never silent).
- Structured tool calls; arguments Zod-validated before execution
  (number→string coercion for trainNumber/PNR, then regex enforced).
- Malformed output, 429s, 4xx/5xx and timeouts are distinct honest error
  events; NO mock model exists in any code path; when nothing is configured
  the turn returns `LLM_NOT_CONFIGURED`.

## Railway tool system (requirements 5 & 6)

Nine tools: SEARCH_TRAINS, GET_TRAIN_INFO, GET_TIMETABLE, TRACK_TRAIN,
CHECK_AVAILABILITY, GET_FARE, CHECK_PNR, GET_CANCELLED_TRAINS,
GENERAL_RAILWAY_ANSWER (provenance marker; makes no external call).

Every `ToolResult` carries: `tool`, `correlationId`
(conversation:turn:toolCall), `status` (ok | not_configured | unavailable |
stale | invalid_arguments | timeout | error), `note` (grounding instruction
to the model), `source`, `retrievedAt`, `freshness`, `journeyDate`,
`classCode`, `data`, `errors`. RAC/WL/REGRET arrive as `status: ok` data —
they are valid outcomes, never technical failures.

Provider layer (unchanged from Phase 1): `ResultEnvelope` with source /
retrievedAt / computed freshness / errors / contradictions; multi-source
conflicts preserved, never averaged. **Zero adapters ship** — see
`provider-terms.md` for the researched verdicts (ConfirmTkt/eRail
unofficial endpoints prohibited; B2B authorization required). Caching never
blocks freshness: repeated enquiries re-invoke tools (the model decides),
and freshness is computed per retrieval.

## UI (requirement 7)

Mobile-first navy/off-white. Chat streams SSE events: thinking dots,
per-tool chips (running → ✓/⚠ with status+freshness), train result cards,
error bubbles with retry, model provenance line under each answer
(`model: meta/muse-glimmer-30b`, `· via configured fallback` when used).
Voice-ready: speech can be added later by speaking the exact verified
`message` text — no second intent engine needed.

## Booking & security (requirements 8 & 9)

Booking/payment/OTP/issuance disabled (`BOOKING_ENABLED` + no
`BookingProvider` implementation; health reports both). `.env.local`
git-ignored; `.env.example` placeholders only; ESLint bans `process.env`
outside server dirs; redacting logger; post-build client-bundle scan now
also covers `nvapi-` keys and `LLM_API_KEY` references; health exposes
provider/model/baseUrl only — never key material.
