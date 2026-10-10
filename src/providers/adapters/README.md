# Adding a railway data provider (adapter)

RailSaarthi AI only talks to **authorized** sources. Before writing a single
line of adapter code, complete this checklist and record it in
`docs/provider-terms.md`:

## Authorization checklist (requirement 10)

- [ ] The source exposes a **documented API** (no undocumented/private endpoints).
- [ ] The access terms **permit the intended use** (aggregation, display, caching within limits).
- [ ] No CAPTCHA bypass, no login circumvention, no security-control evasion of any kind.
- [ ] No scraping of pages whose terms prohibit it.
- [ ] Rate limits and caching rules of the provider are respected in code.
- [ ] Credential is provisioned through the official developer process, not shared/borrowed.
- [ ] A terms record (URL, scope, date, reviewer) is added to `docs/provider-terms.md`.

Registration is **rejected at runtime** if `termsRef` is empty
(`registerAdapter` in `src/providers/registry.ts`).

## Implementation steps

1. Create `src/providers/adapters/<your-id>.ts`.
2. Implement the base `RailwayProvider` contract plus ONE interface per
   capability you support (`TrainSearchProvider`, `PnrProvider`, …) from
   `src/providers/types.ts`.
3. Every method returns a `ResultEnvelope<T>`:
   - validate upstream payloads with the Zod schemas in `src/domain/schemas.ts`;
     anything that fails to parse → `VALIDATION_FAILED` error, `data: null`.
   - build success envelopes with `okEnvelope()` so `retrievedAt` and
     `freshness` are always computed, never hardcoded.
   - never invent or fill in missing fields — omit the data instead.
4. Call `registerAdapter(yourAdapter)` from the adapter module and import the
   module from `src/providers/registry.ts`.
5. Configure deployment env:
   - add the id to `RAILWAY_PROVIDER_IDS`,
   - set `RAILWAY_PROVIDER_<ID_UPPER_SNAKE>_KEY`.
6. Make the adapter pass `tests/contract/` — the invariants run against every
   adapter automatically once it is registered.

## Hard rules

- Adapters must never read env vars other than their own credential.
- Error messages must never include credentials (redaction is enforced by tests).
- Mock/fixture data may only exist under `tests/` — never importable from
  production code paths.
