# रेलसारथी · RailSaarthi AI

Honest, **LLM-first** railway assistant for India — **Hindi, Hinglish and English**.
The LLM is the sole conversational brain: it decides when to answer, when to
clarify, and which railway tools to call. Live railway facts come only from
**authorized data providers**, and every tool result carries its **source,
retrieval timestamp, freshness and correlation id**. When no provider is
configured, the app says exactly that — it never guesses, and there is no
mock model anywhere.

> **Phase 2 status:** LLM-first foundation complete and live-verified with
> NVIDIA `meta/muse-glimmer-30b` (primary) and `openai/gpt-oss-20b`
> (configured fallback) — both tested with real credentials including
> structured tool calling. No railway provider is authorized yet (see
> `docs/provider-terms.md`), so live lookups return honest not-configured
> states. Booking/payment stays disabled by design.

---

## Honesty guarantees (product requirements → mechanisms)

| # | Requirement | Mechanism |
|---|---|---|
| 1 | Mobile-first navy/off-white UI | Tailwind v4 tokens (`src/app/globals.css`), 360px-first layouts, Devanagari font |
| 1b | LLM-first conversation (no rules engine) | `src/assistant/orchestrator.ts` agentic loop; `intents.ts`/scripted replies deleted; structure tests enforce their absence |
| 2 | Hindi/Hinglish/English assistant | LLM mirrors the user's language naturally (system prompt); verified live with Hinglish/Hindi turns |
| 3 | Replaceable provider layer | `src/providers/*` — adapters are plugins behind capability interfaces |
| 4 | 8 capability interfaces | search, details, timetable, live status, availability, fare, PNR, cancellations (`src/providers/types.ts`) |
| 5 | No mock data in live mode | Fixtures live only under `tests/`; adapters return real data or honest errors; canonical `NOT_CONFIGURED` envelope for unconfigured capabilities |
| 6 | Source/timestamp/freshness/errors on every result | `ResultEnvelope` + `SourceBadge`/`FreshnessPill` in the UI |
| 7 | Never invent facts; show contradictions | `data: T | null` typing, Zod gates, `assistant/grounding.ts`, `providers/reconcile.ts` |
| 8 | Server-side LLM config, no key exposure | env-only server modules, ESLint `no-restricted-properties` ban, redacting logger, client-bundle secret scan test |
| 9 | Booking disabled | Booking gate: `BOOKING_ENABLED` + registered `BookingProvider` (interface only in Phase 1) |
| 10 | Legal/compliance guardrails | Adapter registration requires a `termsRef`; no scraping/CAPTCHA-bypass/private endpoints anywhere |

## Stack

Next.js 16 (App Router, TS strict) · React 19 · Tailwind CSS v4 · Zod ·
TanStack Query · Vitest + Testing Library · Playwright (mobile E2E) ·
LLM: any OpenAI-compatible endpoint via `LLM_*` env (verified: NVIDIA
`meta/muse-glimmer-30b`, fallback `openai/gpt-oss-20b`), streamed to the UI
over SSE with per-tool progress events.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint (includes the server-only env guardrail)
npm run typecheck    # tsc --noEmit
npm test             # vitest: unit + contract + security (run after build for the bundle scan)
npm run test:e2e     # playwright @360×800 against the production build
npm run verify       # lint + typecheck + build + unit + e2e
```

## Configuration

Copy `.env.example` to `.env.local` (git-ignored) and fill in ONLY what you
are authorized to use. All variables are server-side only:

- `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_BASE_URL` (+ optional
  `LLM_TIMEOUT_MS`) — any OpenAI-compatible endpoint.
- `LLM_FALLBACK_*` — optional fallback; used only when configured, and every
  switch is surfaced to the user (never silent, never mock).
- `RAILWAY_PROVIDER_IDS` — comma-separated adapter ids. Built-in adapters
  (owner-authorized 2026-10-10, see `docs/provider-terms.md`):
  - `confirmtkt-v1` — PRIMARY: train search, seat availability, fares,
    station lookup. Keyless public endpoint — no `*_KEY` var needed.
  - `erail-v1` — train-search + fare FALLBACK, tried only when the primary
    fails. Keyless.
  - `web-data-v1` — timetable + live running status via the owner-supplied
    web source chains (ixigo→confirmtkt→trainspnrstatus; RailYatri eta JSON
    → RailYatri page → railenquiry). Keyless.
  Other adapters need `RAILWAY_PROVIDER_<ID_UPPER_SNAKE>_KEY` **and** a
  record in `docs/provider-terms.md` before they can register.
  Recommended: `RAILWAY_PROVIDER_IDS=confirmtkt-v1,erail-v1,web-data-v1`.
- `BOOKING_ENABLED` — leave unset; booking is disabled until an authorized
  integration exists.

`scripts/smoke-live.mjs` runs a real end-to-end conversation against a
running server (manual verification tool, not CI).

## Adding a railway data provider

Read `src/providers/adapters/README.md`. Short version: documented API only,
terms must permit the use, record the terms, implement the capability
interfaces, return `ResultEnvelope`s, pass the contract suite.

## Known notes

- `npm audit` reports 5 high advisories in the **dev-only** chain
  `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`
  (GHSA-vfj7-8cjw-p6xm, glob DoS). No fix is published for current
  `eslint-config-next@16`; `npm audit fix --force` would downgrade to
  eslint-config-next@14 (worse). Not shipped to production — tracked for the
  next upstream release.
