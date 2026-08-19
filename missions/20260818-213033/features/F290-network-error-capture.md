# F290: capture failed network requests

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F289

## Assertion IDs covered
- AS-553: failed requests visible to the page are captured

## Draft scope
- Patch `fetch` and `XMLHttpRequest` in the MAIN world to record method, URL, status and duration for failures (network error or status >= 400) into the same bounded buffer as F289.
- Request and response bodies are NOT captured — too large, too sensitive.
- Query strings are recorded but flagged, since they routinely carry tokens.

## Files (approximate)
extension/src/capture/network-hook.ts

## Notes for clarification
- Decide whether to redact obvious secrets in URLs (token=, key=, signature=) before storing. Defaulting to redaction is the safer choice.
- MCP at run: none.
