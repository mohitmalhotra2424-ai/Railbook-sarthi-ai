# RailSaarthi AI — Architecture (Phase 1)

## Layers

```
┌────────────────────────────────────────────────────────────┐
│ UI (mobile-first, navy/off-white)                          │
│  pages: / /chat /trains /trains/[id] /pnr/[pnr] /disruptions│
│  components: EnvelopePanel · SourceBadge · FreshnessPill   │
│              NotConfiguredBanner · ChatClient · SearchForm │
├────────────────────────────────────────────────────────────┤
│ API routes (server-only)  src/app/api/**                   │
│  /assistant  /health  /railway/{search,train,timetable,    │
│               live-status,availability,fare,pnr,           │
│               cancellations}                               │
│  → every response is a ResultEnvelope (Zod-validated)      │
├────────────────────────────────────────────────────────────┤
│ Assistant  src/assistant/**                                │
│  intents (hi/hinglish/en, rule-based) → registry calls     │
│  grounding.ts = ONLY path from data to text                │
│  llm/ = OpenAI/Anthropic/Gemini adapters (env keys)        │
│  LLM is used ONLY for greeting/unknown phrasing — never    │
│  for railway facts                                         │
├────────────────────────────────────────────────────────────┤
│ Provider layer  src/providers/**                           │
│  types.ts      8 capability interfaces + ResultEnvelope    │
│  registry.ts   capability → configured adapters            │
│  reconcile.ts  multi-source merge + contradiction flags    │
│  envelope.ts   ok/error/not-configured builders            │
│  config.ts     env metadata only (never values)            │
│  adapters/     (empty in Phase 1 — none authorized)        │
├────────────────────────────────────────────────────────────┤
│ Domain  src/domain/** — Zod schemas + typed errors         │
│ Lib     src/lib/**    — time, redacting logger, i18n, http │
└────────────────────────────────────────────────────────────┘
```

## The ResultEnvelope contract

Every railway answer — page or API — is wrapped:

```ts
interface ResultEnvelope<T> {
  data: T | null;              // null = unavailable (never fabricated)
  source: SourceInfo;          // providerId, kind, termsRef, authorization
  retrievedAt: string;         // OUR server clock, ISO-8601
  freshness: Freshness;        // computed from retrievedAt + ttlSeconds
  ttlSeconds: number;
  errors: ProviderError[];     // typed codes, UI-safe messages
  confidence: "high" | "medium" | "low";
  contradictions?: Contradiction[];  // sources disagreed — both kept
  requestId: string;
}
```

Invariants are enforced by `tests/contract/` against every adapter output:
shape validity, derived freshness, termsRef on configured sources, no
credentials in error messages.

## Data-flow guarantees

1. **No provider configured** → `notConfiguredEnvelope()` → UI shows
   “Live data provider not configured.” (single canonical copy in i18n).
2. **One provider** → its envelope passes through, re-validated by Zod at
   the route boundary; parse failure downgrades to `data: null`.
3. **Multiple providers** → `reconcileEnvelopes()` compares normalized
   fields per capability; agreement → `confidence: high`; disagreement →
   both values kept in `contradictions`, `confidence: low`, UI shows an
   uncertainty notice. Nothing is averaged or silently resolved.
4. **Assistant text** is rendered only from `envelope.data` fields by
   `grounding.ts`. The LLM (when configured) sees no railway data and may
   only re-phrase greetings; data answers are deterministic.

## Security posture

- Env access is restricted by ESLint to `src/app/api/**`,
  `src/providers/**`, `src/assistant/**`, `src/lib/logger.ts`.
- `lib/logger.ts` redacts every credential-like env value and
  secret-shaped token from log lines.
- `tests/security/client-bundle.test.ts` scans the built client JS for key
  patterns and server env names (runs after `npm run build`).
- Gemini key travels in the `x-goog-api-key` header, never in a URL.
- `.env*` is git-ignored; `.env.example` documents names only.

## Booking gate (requirement 9)

`BOOKING_ENABLED=true` is necessary but not sufficient: booking also
requires a registered `BookingProvider` implementation, and Phase 1 ships
the interface only, with a mandatory terms record. UI states the disabled
status; no payment SDK is installed.

## Rendering model

Live-data pages (`/trains/[id]`, `/pnr/[pnr]`, `/disruptions`) are
`force-dynamic` — rendered per request so `retrievedAt`/`freshness` are
always truthful. Next 16 `cacheComponents` is disabled for that reason
(documented in `next.config.ts`); revisit with per-section Suspense caching
in Phase 2.
