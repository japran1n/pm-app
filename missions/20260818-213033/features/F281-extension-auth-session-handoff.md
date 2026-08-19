# F281: connect the extension to the web app's session

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F280

## Assertion IDs covered
- AS-532: a signed-in web user connects the extension without retyping credentials
- AS-533: a signed-out user is told to sign in and given a link
- AS-538: the shipped bundle contains no secret key

## Draft scope
- A handoff route in the Next app that, for an authenticated session, passes the Supabase session to the extension (via `chrome.runtime.sendMessage` from an allow-listed origin, or a short-lived one-time token the extension exchanges).
- Extension stores the session through a `chrome.storage.local` adapter passed to `createClient({ auth: { storage } })` — MV3 service workers have no localStorage.
- Only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is embedded; a build-time check fails the build if a `sb_secret_` string appears in the bundle.

## Files (approximate)
app/(auth)/extension-connect/route.ts (new), extension/src/auth/*, extension/src/lib/supabase.ts

## Notes for clarification
- The handoff must not be triggerable by an arbitrary site: restrict to the extension's own id via `externally_connectable`.
- MCP at run: none.
