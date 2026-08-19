# F298: minimise permissions

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F280, F287, F289

## Assertion IDs covered
- AS-568: the narrowest permissions that support the features, each justified
- AS-569: works on a never-before-used page with no prior setup

## Draft scope
- Audit the final manifest: `activeTab` and `scripting` should suffice; `<all_urls>` must not appear. Every remaining permission gets a one-line justification in a `PERMISSIONS.md` that the store listing reuses.
- Verify the flow still works on a fresh page where the extension has never run, since `activeTab` is granted per gesture.
- Document what the extension can and cannot see, in plain language, for the privacy disclosure.

## Files (approximate)
extension/manifest.json, extension/PERMISSIONS.md (new)

## Notes for clarification
- Content scripts injected on demand via `chrome.scripting.executeScript` avoid a broad `content_scripts` match — prefer that.
- MCP at run: none.
