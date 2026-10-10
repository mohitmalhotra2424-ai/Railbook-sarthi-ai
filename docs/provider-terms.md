# Provider terms & authorization register

Every railway data provider (and any future booking integration) must have
a record here BEFORE it can be registered in code — `registerAdapter()`
rejects adapters with an empty `termsRef`, and the convention is
`termsRef: "docs/provider-terms.md#<anchor>"`.

## Register

| Anchor / Provider id | Kind | API & docs URL | Terms URL | Permitted use (summary) | Rate limits | Credential provisioned via | Authorized by | Date |
|---|---|---|---|---|---|---|---|---|
| _(none — Phase 1 ships no providers)_ | | | | | | | | |

## Checklist for adding a row (requirement 10)

- [ ] Documented, public API — no undocumented/private endpoints
- [ ] Access terms explicitly permit this product's use (display,
      aggregation, caching within stated limits)
- [ ] No CAPTCHA/login/security-control bypass of any kind
- [ ] No scraping of pages whose terms prohibit it
- [ ] Rate-limit and caching rules encoded in the adapter
- [ ] Credential obtained through the official developer process
- [ ] Reviewer + date recorded above
