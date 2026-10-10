# रेलसारथी · RailSaarthi AI

Honest railway assistant for India — **Hindi, Hinglish and English**.
Live railway facts come only from **authorized data providers**, and every
answer is labelled with its **source, retrieval timestamp and freshness**.
When no provider is configured, the app says exactly that:
**“Live data provider not configured.”** — it never guesses.

> **Phase 1 status:** foundation complete. No live railway provider is
> authorized/configured yet, and booking/payment/ticket issuance is disabled
> by design. See `PLAN.md` for the reviewed plan and `docs/` for details.

---

## Honesty guarantees (product requirements → mechanisms)

| # | Requirement | Mechanism |
|---|---|---|
| 1 | Mobile-first navy/off-white UI | Tailwind v4 tokens (`src/app/globals.css`), 360px-first layouts, Devanagari font |
| 2 | Hindi/Hinglish/English assistant | `src/assistant/intents.ts` locale detection + tri-lingual strings (`src/lib/i18n.ts`); optional LLM for conversational phrasing only |
| 3 | Replaceable provider layer | `src/providers/*` — adapters are plugins behind capability interfaces |
| 4 | 8 capability interfaces | search, details, timetable, live status, availability, fare, PNR, cancellations (`src/providers/types.ts`) |
| 5 | No mock data in live mode | Zero adapters ship in Phase 1; fixtures live only under `tests/`; canonical `NOT_CONFIGURED` envelope everywhere |
| 6 | Source/timestamp/freshness/errors on every result | `ResultEnvelope` + `SourceBadge`/`FreshnessPill` in the UI |
| 7 | Never invent facts; show contradictions | `data: T | null` typing, Zod gates, `assistant/grounding.ts`, `providers/reconcile.ts` |
| 8 | Server-side LLM config, no key exposure | env-only server modules, ESLint `no-restricted-properties` ban, redacting logger, client-bundle secret scan test |
| 9 | Booking disabled | Booking gate: `BOOKING_ENABLED` + registered `BookingProvider` (interface only in Phase 1) |
| 10 | Legal/compliance guardrails | Adapter registration requires a `termsRef`; no scraping/CAPTCHA-bypass/private endpoints anywhere |

## Stack

Next.js 16 (App Router, TS strict) · React 19 · Tailwind CSS v4 · Zod ·
TanStack Query · Vitest + Testing Library · Playwright (mobile E2E) ·
LLM adapters: OpenAI, Anthropic, Gemini (server-side, env-driven).

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

Copy `.env.example` to `.env` and fill in ONLY what you are authorized to
use. All variables are server-side only:

- `LLM_PROVIDER` — `openai` | `anthropic` | `gemini` | `disabled`
  (+ the matching `*_API_KEY`, optional `*_MODEL`, `OPENAI_BASE_URL`)
- `RAILWAY_PROVIDER_IDS` — comma-separated adapter ids; each needs
  `RAILWAY_PROVIDER_<ID_UPPER_SNAKE>_KEY` **and** a record in
  `docs/provider-terms.md` before it can register.
- `BOOKING_ENABLED` — leave unset; see requirement 9.

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
