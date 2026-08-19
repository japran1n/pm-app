# F288: collect environment metadata

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F283

## Assertion IDs covered
- AS-548: URL, browser and version, OS, viewport size, device pixel ratio
- AS-549: reporter identity and capture timestamp

## Draft scope
- One collector module returning a typed object; no scattered `navigator.*` reads across the codebase.
- Timestamp recorded as an instant plus the reporter's timezone, so it renders correctly for readers elsewhere (this mission's F124 convention).
- Values that cannot be determined are recorded as unknown rather than guessed.

## Files (approximate)
extension/src/capture/environment.ts

## Notes for clarification
- `navigator.userAgent` is increasingly reduced; prefer `navigator.userAgentData` where available and record which source was used.
- MCP at run: none.
