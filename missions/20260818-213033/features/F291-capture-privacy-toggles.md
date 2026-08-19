# F291: let the reporter control what is sent

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F290

## Assertion IDs covered
- AS-554: console and network capture can be turned off per report

## Draft scope
- Toggles in the report form showing exactly what each one includes, with the counts captured ("12 console errors, 3 failed requests").
- Preference persists per user but is always visible and reversible before sending.
- With capture off, nothing is collected — not collected-then-discarded.

## Files (approximate)
extension/src/popup/privacy-toggles.tsx, extension/src/capture/index.ts

## Notes for clarification
- A reporter should be able to preview the captured logs before sending; decide whether that lands here or is deferred.
- MCP at run: none.
