# F297: offline and failure handling

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F294

## Assertion IDs covered
- AS-565: an offline submission reports the failure and loses neither typed input nor annotations

## Draft scope
- Draft (form values + annotated image) persisted to `chrome.storage.local` before the network call, restored when the popup reopens.
- Distinct, actionable messages for: offline, expired session, permission denied, upload too large, server error.
- A retry path that reuses the persisted draft rather than asking the user to redo the annotation.

## Files (approximate)
extension/src/submit/draft.ts, extension/src/popup/errors.tsx

## Notes for clarification
- Storage quota: a large PNG in chrome.storage.local can exceed limits — decide the cap and what happens past it.
- MCP at run: none.
