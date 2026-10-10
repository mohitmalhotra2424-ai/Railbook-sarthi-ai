# Provider terms & authorization register

Every railway data provider (and any future booking integration) must have a
record here BEFORE it can be registered in code — `registerAdapter()` rejects
adapters with an empty `termsRef` (convention: `docs/provider-terms.md#<anchor>`).

## Register

| Anchor / Provider id | Kind | API & docs URL | Terms URL | Permitted use (summary) | Rate limits | Credential via | Authorized by | Date |
|---|---|---|---|---|---|---|---|---|
| _(none — no source is authorized yet; live mode reports not-configured)_ | | | | | | | | |

## Source research — 2026-10-10 (research only, no automated access performed)

| Source | Finding | Verdict |
|---|---|---|
| **ConfirmTkt** | Commercial B2B/partner APIs exist; the web-app endpoints used by hobby projects are *unofficial and undocumented* and "may breach those sites' terms" (documented as such even in community MCP projects). | ❌ Not usable without an explicit B2B agreement. Pursue partnership if the owner wants live data. |
| **RailYatri** | IRCTC-authorized partner; data APIs are partner/B2B channels, no public self-serve developer API found. | ❌ Not usable without explicit authorization. |
| **eRail** | Website only; the endpoints people use are undocumented/private. | ❌ Prohibited by our rules (undocumented private endpoints). |
| **Trainman** | IRCTC-authorized booking partner; Android app removed from Play (Sep 2025); no public data API. | ❌ Not usable without explicit authorization. |
| **NTES (CRIS, official)** | Official live-status site; community documentation notes its terms forbid building databases/commercial use. | ⚠️ Only within its published terms; needs review before any use. |
| **Railway Board “Trains at a Glance 2026”** | Official published static timetable dataset (schedules, not live status). | ✅ Candidate for a static-timetable adapter in a later phase, subject to its publication terms. |

**Conclusion:** as of 2026-10-10 no source qualifies for automated access under
requirement 10, so the app ships with zero adapters and every live lookup
returns the honest `not_configured` state. Adding a provider later requires:
authorization evidence, a row above, and passing the contract suite — no
redesign of the LLM layer needed (tools call the provider registry, which is
adapter-pluggable).

## Checklist for adding a row (requirement 10)

- [ ] Documented, public API — no undocumented/private endpoints
- [ ] Access terms explicitly permit this product's use (display, aggregation, caching within stated limits)
- [ ] No CAPTCHA/login/security-control bypass of any kind
- [ ] No scraping of pages whose terms prohibit it
- [ ] Rate-limit and caching rules encoded in the adapter
- [ ] Credential obtained through the official developer process
- [ ] Reviewer + date recorded above
