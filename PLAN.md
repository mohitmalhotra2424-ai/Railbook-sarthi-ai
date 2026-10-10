# RailSaarthi AI — Phase 1: Clean Foundation — PLAN (reviewed & executed)

Status: **APPROVED & EXECUTED — Phase 1 complete (2026-10-10).**
Decisions D1–D4 resolved 2026-10-10 (§8); the build below was executed the
same day after explicit approval. Verification: `eslint` ✓ ·
`tsc --noEmit` ✓ · `vitest` 89/89 ✓ (unit + contract + client-bundle secret
scan) · `next build` ✓ · `playwright` 8/8 @360×800 ✓. No push, no deploy,
no env changes; git is local-only with repo-level identity.

---

## 1. Environment inspection report (verified by command output)

| Item | Finding |
|---|---|
| OS | Debian GNU/Linux 13 (trixie), kernel 6.1.158+, x86_64 |
| Workspace `/home/user` | **Completely empty** (`ls -la` shows no entries besides `.`/`..`) |
| `railsaarthi-ai` folder/repo | **Does not exist** (case-insensitive `find` returned nothing) → safe to create fresh, no overwrite risk |
| `BookKaro` project | **Not present anywhere** in the workspace (same `find`, depth 4) → isolation rule trivially satisfied; nothing will be touched |
| Node.js | v20.20.2 ✅ (meets Next.js 15/16 requirement of Node ≥ 18.18) |
| npm | 10.8.2 ✅ (registry `https://registry.npmjs.org/` reachable — verified `HTTP/2 200`, no install performed) |
| pnpm / yarn / bun / deno | Not installed → plan uses **npm** (corepack 0.34.6 is available if pnpm is preferred) |
| Python | 3.13.16 (available; not needed for Phase 1) |
| git | 2.47.3 ✅ — **identity not configured** (`user.name`/`user.email` unset). If local commits are approved, a **repo-level** identity will be set (never global config) |
| Docker | Not installed → no container-based workflow in Phase 1 |
| Resources | 2 CPUs, **1.9 GB RAM**, 21 GB free disk. Workable for Next.js dev/build; Playwright browsers ≈150 MB download — feasible but flagged (see decision point D4) |
| LLM/API env vars | **None set** (names checked; values never displayed). The app must therefore ship working in the “LLM provider not configured” state |
| Global npm packages | Only npm, corepack, ijavascript — no conflicting CLIs |

---

## 2. Proposed stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | **TypeScript (strict mode)** | Provider contracts and result envelopes must be compile-time enforced |
| Framework | **Next.js (latest stable, App Router) — single project** | SSR/React Server Components for mobile-first pages; Route Handlers keep all provider/LLM calls server-side; one deployable unit, no separate API server to leak keys from |
| UI | **React 19 + Tailwind CSS v4** (as scaffolded by `create-next-app`) | Utility styling with CSS-variable design tokens (navy/off-white); hand-rolled accessible components; no heavy UI kit |
| Fonts | `next/font` with **Devanagari-capable** stack (e.g., Noto Sans Devanagari) | Required for natural Hindi rendering; downloaded at build time, so offline previews still work |
| Client data | **TanStack Query** | Cache/retry semantics pair naturally with `freshness`/`ttl` in the result envelope |
| LLM | **Named server-side adapters: OpenAI, Anthropic, Gemini** (decision D3) | Each vendor behind a shared `LlmAdapter` interface; keys env-only; assistant code stays vendor-agnostic |
| Validation | **Zod** | Every provider payload is schema-validated at the boundary; invalid → typed error, never guessed data |
| Tests | **Vitest + Testing Library** (unit/integration), **Playwright** (mobile-viewport E2E) | Fast core suite; E2E proves the mobile UX and the “not configured” states |
| Quality gates | ESLint + Prettier + `tsc --noEmit`, plus a **secret-leak bundle scan** test | Requirement 8 (no keys in client code/logs) enforced mechanically, not by convention |
| Package manager | **npm** (pnpm via corepack if you prefer) | Only npm is installed in this sandbox |

Deliberately **excluded**: any IRCTC/railway client library (none authorized), any scraping tool
(Playwright is for our own E2E tests only, never pointed at third-party sites), any payment/booking SDK
(disabled per requirement 9), any client-side env usage.

---

## 3. Proposed folder structure

```
railsaarthi-ai/                      # created only after plan approval; verified-absent first
├── PLAN.md                          # this document (copied in)
├── README.md
├── package.json / tsconfig.json / next.config.ts / eslint.config.mjs
├── .env.example                     # placeholder NAMES only — never real values
├── .gitignore                       # includes .env*, never commits secrets
├── src/
│   ├── app/                         # pages (mobile-first) + server-only API
│   │   ├── layout.tsx  page.tsx     # landing + assistant entry
│   │   ├── chat/page.tsx            # conversational assistant
│   │   ├── trains/page.tsx          # search results (empty-state aware)
│   │   ├── trains/[id]/page.tsx     # details + timetable + live status
│   │   ├── pnr/[pnr]/page.tsx
│   │   ├── disruptions/page.tsx     # cancellations/diversions
│   │   └── api/
│   │       ├── health/route.ts      # capability × provider configuration status
│   │       ├── assistant/route.ts   # LLM orchestration — server-only
│   │       └── railway/
│   │           ├── search/route.ts
│   │           ├── train/[id]/route.ts
│   │           ├── timetable/[id]/route.ts
│   │           ├── live-status/route.ts
│   │           ├── availability/route.ts
│   │           ├── fare/route.ts
│   │           ├── pnr/[pnr]/route.ts
│   │           └── cancellations/route.ts
│   ├── providers/                   # ← the replaceable data-provider layer
│   │   ├── types.ts                 # interfaces + ResultEnvelope (section 4)
│   │   ├── envelope.ts              # builds/validates envelopes (source, timestamp, freshness, errors)
│   │   ├── registry.ts              # capability → configured adapter(s), ordered
│   │   ├── config.ts                # reads env; exposes only booleans/metadata — never values
│   │   ├── reconcile.ts             # multi-source merge + contradiction detection
│   │   └── adapters/
│   │       ├── README.md            # “How to add a provider” + terms-authorization checklist
│   │       └── (no adapters in Phase 1 — none are authorized yet)
│   ├── domain/
│   │   ├── schemas.ts               # Zod: TrainSummary, TimetableEntry, LiveStatus,
│   │   │                            #       Availability, Fare, PnrStatus, Disruption…
│   │   └── errors.ts                # typed error codes (NOT_CONFIGURED, UPSTREAM_ERROR, …)
│   ├── assistant/
│   │   ├── llm/types.ts             # shared LlmAdapter interface (vendor-agnostic)
│   │   ├── llm/config.ts            # LLM_PROVIDER + per-vendor keys, read server-side only
│   │   ├── llm/adapters/
│   │   │   ├── openai.ts            # OPENAI_API_KEY (+ OPENAI_BASE_URL, OPENAI_MODEL)
│   │   │   ├── anthropic.ts         # ANTHROPIC_API_KEY (+ ANTHROPIC_MODEL)
│   │   │   └── gemini.ts            # GEMINI_API_KEY (+ GEMINI_MODEL)
│   │   ├── llm/client.ts            # adapter dispatch + graceful “not configured” path
│   │   ├── intents.ts               # hi/hinglish/en intent routing → capability calls
│   │   └── grounding.ts             # assistant may ONLY state fields present in provider data
│   ├── components/                  # Button, Card, ResultCard, SourceBadge,
│   │                                # FreshnessPill, UncertaintyNotice, NotConfiguredBanner…
│   ├── styles/tokens.css            # navy/off-white design tokens
│   └── lib/
│       ├── logger.ts                # redacting logger (strips any configured secret value)
│       └── time.ts                  # freshness computation from retrievedAt + ttl
├── tests/
│   ├── unit/                        # envelope, registry, reconcile, config, redaction, time
│   ├── contract/                    # invariants EVERY adapter must satisfy (section 4.3)
│   ├── security/                    # bundle scan: no secret patterns in client JS
│   └── e2e/                         # Playwright @360×800: flows + empty states
└── docs/
    ├── architecture.md
    └── provider-terms.md            # per-provider authorization record (terms ref, scope, date)
```

---

## 4. Data-provider layer — proposed interfaces

### 4.1 Core types

```ts
// Every public answer is wrapped — no bare data ever reaches the UI.
export type Freshness = 'fresh' | 'stale' | 'unknown';

export interface SourceInfo {
  providerId: string;                 // e.g. 'acme-rail-api-v1'
  kind: 'official-api' | 'authorized-partner' | 'open-dataset';
  termsRef: string;                   // URL/record in docs/provider-terms.md permitting this use
  authorization: 'configured' | 'not-configured';
}

export type ProviderErrorCode =
  | 'NOT_CONFIGURED' | 'UPSTREAM_ERROR' | 'RATE_LIMITED' | 'TIMEOUT'
  | 'VALIDATION_FAILED' | 'UNAUTHORIZED_SOURCE' | 'BOOKING_DISABLED';

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;                    // UI-safe; redaction-tested; never contains credentials
  retryable: boolean;
  detailRef?: string;                 // request id for server logs — never the raw upstream body
}

export interface ResultEnvelope<T> {
  data: T | null;                     // null whenever unavailable — fabrication is impossible by type
  source: SourceInfo;
  retrievedAt: string;                // ISO-8601, set by OUR server clock at receipt
  freshness: Freshness;               // derived from retrievedAt + ttlSeconds (+ upstream headers)
  ttlSeconds: number;
  errors: ProviderError[];
  confidence: 'high' | 'medium' | 'low';
  contradictions?: Contradiction[];   // populated when ≥2 sources disagree (4.4)
  requestId: string;
}

export interface QueryContext {
  locale: 'hi' | 'hinglish' | 'en';
  requestId: string;
}
```

### 4.2 Capability interfaces (one per requirement-4 domain, each independently replaceable)

```ts
export type Capability =
  | 'trainSearch' | 'trainDetails' | 'timetable' | 'liveStatus'
  | 'seatAvailability' | 'fare' | 'pnr' | 'cancellations';

export interface RailwayProvider {
  readonly id: string;
  readonly capabilities: Capability[];
  readonly termsRef: string;          // must be non-empty to register (compliance gate)
  health(): Promise<{ ok: boolean; latencyMs: number; errors: ProviderError[] }>;
}

export interface TrainSearchProvider extends RailwayProvider {
  search(q: { text?: string; from?: string; to?: string; date?: string },
         ctx: QueryContext): Promise<ResultEnvelope<TrainSummary[]>>;
}
export interface TrainDetailsProvider extends RailwayProvider {
  details(trainId: string, ctx: QueryContext): Promise<ResultEnvelope<TrainDetails>>;
}
export interface TimetableProvider extends RailwayProvider {
  timetable(trainId: string, date?: string, ctx?: QueryContext): Promise<ResultEnvelope<Timetable>>;
}
export interface LiveStatusProvider extends RailwayProvider {
  liveStatus(trainId: string, date: string, ctx: QueryContext): Promise<ResultEnvelope<LiveStatus>>;
}
export interface SeatAvailabilityProvider extends RailwayProvider {
  availability(q: { trainId: string; date: string; from: string; to: string; classCode?: string },
               ctx: QueryContext): Promise<ResultEnvelope<Availability>>;
}
export interface FareProvider extends RailwayProvider {
  fare(q: { trainId: string; from: string; to: string; classCode: string; quota?: string },
       ctx: QueryContext): Promise<ResultEnvelope<Fare>>;
}
export interface PnrProvider extends RailwayProvider {
  pnr(pnr: string, ctx: QueryContext): Promise<ResultEnvelope<PnrStatus>>;
}
export interface CancellationsProvider extends RailwayProvider {
  cancellations(q: { date?: string; zone?: string; trainId?: string },
                ctx: QueryContext): Promise<ResultEnvelope<Disruption[]>>;
}
```

**Registry & routing.** `registry.ts` resolves each capability to the ordered list of adapters whose
ids appear in env config (e.g. `RAILWAY_PROVIDER_IDS=a,b` + per-provider key vars). A provider with no
credentials registered is *never* instantiated. With **zero configured providers** (Phase 1 state),
every route returns the canonical envelope: `data: null`, `errors: [{ code: 'NOT_CONFIGURED' }]` →
UI renders **“Live data provider not configured.”** No mock data path exists in production code;
fixtures live only under `tests/` and are unreachable from server bundles.

### 4.3 Invariants enforced by contract tests (any future adapter must pass)

1. Return value always parses as `ResultEnvelope<T>` with `data` either `null` or Zod-valid domain data — partial/invented fields are a hard failure.
2. `source`, `retrievedAt` (server clock), `freshness`, `ttlSeconds`, `errors` always present.
3. `freshness` is *computed* (`lib/time.ts`), never hardcoded to `'fresh'`.
4. Error messages contain no credentials (redaction test asserts against every configured secret value).
5. Adapters only call **documented, authorized endpoints** — registration requires a non-empty `termsRef`; the terms checklist (no ToS-violating scraping, no CAPTCHA/login bypass, no undocumented private endpoints) is recorded in `docs/provider-terms.md`.

### 4.4 Multi-source reconciliation (requirement 7)

When ≥2 providers serve one capability, `reconcile.ts` compares normalized fields (e.g., departure
times, fare amounts). Agreement → `confidence: 'high'`. Disagreement → both values retained with a
`Contradiction { field, values: [{providerId, value}] }`, `confidence: 'low'`, and the UI shows an
uncertainty notice. Values are never averaged, merged, or “resolved” silently.

### 4.5 LLM configuration (requirement 8)

- Env-only, server-side. `LLM_PROVIDER` selects **one named adapter**:
  `openai` | `anthropic` | `gemini` | `disabled` (default when nothing is configured). Each adapter
  reads only its own credentials: `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `OPENAI_MODEL`),
  `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`), `GEMINI_API_KEY` (+ `GEMINI_MODEL`). All are read
  exclusively in `src/assistant/llm/adapters/*` (server modules); a shared `LlmAdapter` interface
  keeps the assistant code vendor-agnostic.
- **Zero keys are set in this sandbox today** → all three adapters report `not-configured`, and
  Phase 1 ships and passes tests in that state (assistant replies with a deterministic, honest
  fallback; no fabricated answers). Adapters are unit-tested against mocked transports — no live
  vendor calls in CI.
- Enforcement: ESLint `no-restricted-properties` bans `process.env` outside server modules; a security
  test scans the production client bundle for secret-shaped strings; `lib/logger.ts` redacts any
  configured secret value from every log line (unit-tested).
- **Grounding rule:** the assistant may only present railway facts present in `ResultEnvelope.data`;
  `grounding.ts` is the choke point and is unit-tested against “temptation” prompts (inventing a PNR
  status, a fare, a timing must be impossible).

### 4.6 Booking gate (requirement 9)

`BOOKING_ENABLED` defaults absent/false. Even if `true`, all booking flows require a registered
`BookingProvider` adapter (interface stubbed, **no implementation in Phase 1**) plus a recorded
authorization in `docs/provider-terms.md`. All booking UI renders an explicit disabled state.
No payment SDK dependency will be installed.

---

## 5. Exact Phase 1 build plan (executed only after approval)

| # | Step | Acceptance criteria |
|---|---|---|
| M0 | Guard checks: re-verify `railsaarthi-ai` absent; verify no `BookKaro` anywhere | Both checks pass (re-run of today’s `find`) |
| M1 | Scaffold: `npx create-next-app@latest railsaarthi-ai` (TS, Tailwind, ESLint, App Router, `src/`); `git init` **local only, no remote, no push**, repo-level identity (decision D2 confirmed) | `npm run build` green on fresh scaffold |
| M2 | Design system: navy/off-white tokens in `styles/tokens.css`; base components; Devanagari font via `next/font`; 360px-first layout grid | Storybook-free visual check via dev server preview; Lighthouse mobile ≥ 90 on landing |
| M3 | Provider core: `types.ts`, `envelope.ts`, `registry.ts`, `config.ts`, `reconcile.ts`, `lib/time.ts`, redacting logger | Unit tests green for envelope building, freshness math, registry with 0 providers, contradiction detection on fixture sources |
| M4 | API routes: 8 railway routes + `/api/health` + `/api/assistant`; all Zod-validated; all return canonical `NOT_CONFIGURED` envelopes today | Integration tests (Vitest + route handlers) assert envelope shape & error codes; `curl /api/health` shows all 8 capabilities `not-configured` |
| M5 | Assistant: intent routing (hi/hinglish/en), `LlmAdapter` interface + OpenAI/Anthropic/Gemini named adapters, `llm/config.ts`, `grounding.ts` | Without keys: deterministic fallback response; adapter unit tests pass on mocked transports; grounding tests prove no fabricated facts |
| M6 | UI pages: landing, chat, search, train detail, PNR, disruptions — every data surface wired to `SourceBadge`, `FreshnessPill`, `NotConfiguredBanner` | Manual + E2E verification of “Live data provider not configured.” on every data surface |
| M7 | Test suite hardening: contract tests, security bundle scan, Playwright E2E (360×800: landing, chat fallback, search empty state, PNR page, health JSON) | All suites green (see §6) |
| M8 | Docs: `README.md`, `docs/architecture.md`, `docs/provider-terms.md`, `.env.example` (names only) | Reviewer can add a provider by following `adapters/README.md` alone |

Out of Phase 1 scope: any live railway adapter (none authorized), booking/payment, user accounts,
DB persistence (envelope caching only via HTTP cache headers + TanStack Query), i18n beyond
hi/hinglish/en strings.

---

## 6. Exact Phase 1 test plan

**Commands (all must pass before “Phase 1 done” is claimed):**

```bash
npm run lint          # ESLint (incl. no-process.env-in-client rule)
npx tsc --noEmit      # strict typecheck
npm test              # vitest run  (unit + contract + security)
npm run build         # production build succeeds
npx playwright test   # E2E, mobile viewport (subject to decision D4)
```

| Suite | Location | Key assertions |
|---|---|---|
| Unit — envelope/time | `tests/unit/envelope.test.ts`, `time.test.ts` | required fields always present; freshness transitions fresh→stale correctly; `retrievedAt` server-set |
| Unit — registry/config | `registry.test.ts`, `config.test.ts` | 0 providers → every capability yields `NOT_CONFIGURED` envelope; env parsing exposes no values |
| Unit — reconcile | `reconcile.test.ts` | agreeing sources → high confidence; conflicting times/fares → `contradictions[]` + low confidence, both values retained |
| Unit — grounding & redaction | `grounding.test.ts`, `logger.test.ts` | assistant output contains only envelope-sourced facts; no configured secret value appears in any log line |
| Unit — LLM adapters | `tests/unit/llm/*.test.ts` | each of openai/anthropic/gemini: request shaping vs a mocked transport; missing key → `not-configured` (never a throw, never the key value in an error); upstream error mapping; no live calls |
| Contract | `tests/contract/provider-contract.test.ts` | the §4.3 invariants, run against a fixture adapter that deliberately violates each one (each violation must fail) |
| Security | `tests/security/client-bundle.test.ts` | post-build scan of client JS for `sk-`, key-like strings, `LLM_API_KEY`, `process.env` leakage |
| Integration | `tests/unit/routes/*.test.ts` | each of the 9 API routes returns a valid envelope with correct error code in the unconfigured state |
| E2E (Playwright, 360×800) | `tests/e2e/*.spec.ts` | landing renders; chat gives honest not-configured reply; search/PNR pages show “Live data provider not configured.”; `/api/health` JSON correct; no console errors |

Resource note: sandbox has 1.9 GB RAM — builds get `NODE_OPTIONS=--max-old-space-size=1536` if needed;
if Playwright browser install proves infeasible, E2E is deferred with explicit notice (decision D4).

---

## 7. Requirement → mechanism map (all 10 product requirements)

1. Mobile-first navy/off-white UI → M2 tokens + 360px-first layouts + Lighthouse gate.
2. Hindi/Hinglish/English assistant → `assistant/intents.ts` locale routing + Devanagari font; LLM optional.
3. Modular replaceable providers → §4.2 interfaces + registry; adapters are plugins, zero coupling.
4. Eight capability interfaces → §4.2 (search, details, timetable, live status, availability, fare, PNR, cancellations).
5. No mocks in live mode → fixtures exist only under `tests/`; unconfigured → “Live data provider not configured.”
6. Source/timestamp/freshness/errors tracking → `ResultEnvelope` on every response; `SourceBadge`/`FreshnessPill` in UI.
7. No invented facts + contradiction detection → `data: T | null` typing, Zod gates, `grounding.ts`, `reconcile.ts`.
8. Server-side LLM config, no key exposure → env-only server modules, ESLint ban, bundle-scan test, redacting logger.
9. Booking disabled → booking gate (§4.6); no payment SDK installed in Phase 1.
10. Legal/compliance guardrails → adapter registration requires `termsRef`; no scraping/CAPTCHA-bypass/private-endpoint code anywhere; Playwright restricted to our own E2E.

---

## 8. Decision points — RESOLVED (2026-10-10)

- **D1 — Framework:** ✅ **Next.js single project** (App Router + Route Handlers; all provider/LLM calls server-side by construction).
- **D2 — Git:** ✅ **Local git with commits** — repo-level identity only; no remote, no push; BookKaro and global git config untouched.
- **D3 — LLM config shape:** ✅ **Named adapters now** — OpenAI + Anthropic + Gemini behind a shared `LlmAdapter` interface (§4.5); keys env-only per vendor.
- **D4 — E2E:** ✅ **Playwright included in Phase 1** (360×800). If the browser install proves infeasible on 1.9 GB RAM, that will be flagged explicitly, not silently dropped.

Execution of §5 (M0–M8) begins only on explicit approval.

---

## Addendum — superseded decisions (Prompts 2 & 3, 2026-10-10)

The following Prompt-1 decisions were **superseded by the owner-approved
Prompt-2 architecture** (LLM-first) and verified again in the Prompt-3 audit:

- **§2/§4.5/M5 “Named adapters (OpenAI/Anthropic/Gemini)” → REPLACED** by a
  generic **OpenAI-compatible LLM client** (`src/assistant/llm/client.ts`)
  configured via `LLM_PROVIDER / LLM_MODEL / LLM_API_KEY / LLM_BASE_URL`.
  Verified live against NVIDIA `meta/muse-glimmer-30b` (primary) and
  `openai/gpt-oss-20b` (explicitly configured fallback), including
  structured tool calling.
- **M5 “intent routing (hi/hinglish/en)” → DELETED.** The LLM is the sole
  conversational interpreter and tool orchestrator; `intents.ts`,
  `grounding.ts` and `respond.ts` no longer exist (enforced by structure
  tests in `tests/unit/orchestrator.test.ts`).
- **Railway sources:** ~~ConfirmTkt, eRail, RailYatri, Trainman and
  IRCTC live-pull are scrapped for automated access (owner decision,
  Prompt 3).~~ **Superseded the same day (2026-10-10) by a newer explicit
  owner instruction:** scrape **ConfirmTkt** (seat availability, station
  lookup, fare + search) as the primary live source, with **RailYatri/eRail**
  as fallback. Implemented as `confirmtkt-v1` (primary) and `erail-v1`
  (search-only fallback; RailYatri's public pages 404 and its APIs are
  B2B-only, so it was not wired). Trainman and IRCTC live-pull remain
  scrapped. Full caveats and the owner-decision record:
  `docs/provider-terms.md`. Live lookups now return real data; unconfigured
  capabilities (PNR, live status, timetable, cancellations) still return the
  honest `not_configured` state.
