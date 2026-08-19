# F300: build, package, and ship

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F298, F299

## Assertion IDs covered
- AS-571: a repeatable build command produces a distributable artifact

## Draft scope
- `npm run build:extension` producing both an unpacked dev build and a store-ready zip, with the version read from one place.
- Build-time guard failing the build if a `sb_secret_` string or any `.env` server value appears in the bundle (backs AS-538).
- Icons at required sizes, a privacy disclosure, and a store-listing checklist covering the permission justifications from F298.
- README section: how to load unpacked for testing, and what a human must do to publish (Chrome Web Store account, one-time US$5 fee, review typically days but sometimes weeks — the orchestrator cannot register or pay).

## Files (approximate)
extension/vite.config.ts, package.json, extension/store-listing.md (new), README.md

## Notes for clarification
- Unlisted distribution covers internal team use without a public listing; note it as the likely first step.
- MCP at run: none.
