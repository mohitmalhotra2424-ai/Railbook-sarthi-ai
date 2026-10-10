# Provider terms & authorization register

Every railway data provider (and any future booking integration) must have a
record here BEFORE it can be registered in code — `registerAdapter()` rejects
adapters with an empty `termsRef` (convention: `docs/provider-terms.md#<anchor>`).

## Register

| Anchor / Provider id | Kind | API & docs URL | Terms URL | Permitted use (summary) | Rate limits | Credential via | Authorized by | Date |
|---|---|---|---|---|---|---|---|---|
| `#confirmtkt-v1` | Unofficial web-app endpoints (owner-directed) | `https://cttrainsapi.confirmtkt.com/api/v1/trains/search` + `/api/v2/trains/stations/auto-suggestion` (no public docs; contract reverse-documented by github.com/uditya-kumar/confirmtkt-mcp) | none published | Train search, seat availability, fares, station lookup — display in this app | None published; we self-limit: 60 s search cache, 24 h station cache, 15 s timeout | None (keyless; `clientid`/`apikey` are static public constants from ConfirmTkt's own JS bundle, not per-user secrets) | **Owner, explicit instruction 2026-10-10** ("scrape confirmtkt for seat availability, station lookup, fare") | 2026-10-10 |
| `#erail-v1` | Unofficial site data endpoints (owner-directed fallback) | `https://erail.in/rail/getTrains.aspx` (~/^ delimited feed), `https://erail.in/train-fare/<no>` (SSR table), `https://erail.in/js/cmp/stations.js` (static station table) — no public docs | none published | Train-search + fare FALLBACK and station lookup, used when confirmtkt-v1 fails | Throttles occasionally ("Please try again after some time"); we self-limit: 1 h TBS cache, 6 h fare/station cache; throttle → honest RATE_LIMITED | None (keyless) | **Owner, explicit instruction 2026-10-10** ("if not available then scrape data from railyatri or erail"; endpoint details supplied by owner same day) | 2026-10-10 |

### Owner decision of 2026-10-10 (supersedes the "no source authorized" conclusion below)

The owner explicitly directed scraping ConfirmTkt (primary) with RailYatri/eRail
as fallbacks. Recorded caveats, kept visible on purpose:

- These endpoints are **unofficial and undocumented**; they may change, throttle
  or block access at any time. Every failure surfaces as an honest error
  (`UPSTREAM_ERROR` / `RATE_LIMITED` / `NOT_FOUND` / `VALIDATION_FAILED`) —
  never as fabricated data.
- No login, CAPTCHA bypass or security-control evasion is involved; requests
  use the sites' own public web clients.
- **RailYatri was investigated and NOT wired**: its former public
  trains-between-stations pages now 404/301 (probed 2026-10-10) and its data
  APIs are B2B-only, so eRail is the implemented fallback. UPDATE (same day,
  owner supplied `sa.railyatri.in/api/v3/seat/availability/...`): probed live —
  every `user_id` variant (owner's `-2345434`, `-1`, `0`, absent) returns
  `{"success":false,"message":"Invalid User Id."}`. The endpoint needs a
  valid RailYatri session user id which we do not have and will not guess;
  wiring resumes the moment a working id is supplied.
- If either site objects or blocks us, remove its id from
  `RAILWAY_PROVIDER_IDS` — the app degrades to honest not-configured answers.

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
