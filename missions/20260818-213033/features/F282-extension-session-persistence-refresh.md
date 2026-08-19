# F282: session persistence and refresh

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F281

## Assertion IDs covered
- AS-534: session survives browser restart
- AS-535: session survives service-worker idle/restart
- AS-536: expired sessions refresh silently; a failed refresh signs out with a reason
- AS-537: signing out clears stored session

## Draft scope
- Refresh on popup open rather than relying on background timers — an MV3 worker idles out and loses in-memory state.
- Explicit sign-out clearing `chrome.storage.local` and any cached user profile.
- Tests covering: cold start with stored session, expired token, refresh failure.

## Files (approximate)
extension/src/auth/session.ts, extension/src/background/index.ts

## Notes for clarification
- Decide whether the extension holds its own refresh loop or refreshes lazily per action — lazy is simpler and matches MV3's lifecycle.
- MCP at run: none.
