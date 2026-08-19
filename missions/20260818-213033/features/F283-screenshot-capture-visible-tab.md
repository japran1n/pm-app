# F283: capture the visible tab

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F280

## Assertion IDs covered
- AS-539: capture control screenshots the visible area
- AS-541: a capture without permission explains itself instead of failing silently

## Draft scope
- `chrome.tabs.captureVisibleTab` triggered by a user gesture in the POPUP (the `activeTab` grant is documented as unreliable from a side panel).
- Restricted pages (chrome://, the Web Store, other extensions) must produce a clear message naming why capture is unavailable.
- Captured PNG handed to the annotation stage as a data URL / blob.

## Files (approximate)
extension/src/capture/visible-tab.ts, extension/src/popup/*

## Notes for clarification
- Device pixel ratio: capture returns physical pixels; annotations are placed in CSS pixels. Fix the mapping here, not in the annotation feature.
- MCP at run: none.
