# F009: expired link handling

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 20 minutes
**Depends on:** F008

## Assertion IDs covered
- AS-004
- AS-145

## Draft scope
- Expired/used magic-link error state on the callback route
- Offers a 'resend link' action back to sign-in

## Files (approximate)
app/(auth)/auth/callback/route.ts, app/(auth)/sign-in/page.tsx

## Notes for clarification
Document in the handoff that Supabase Auth's built-in email-request throttling is what satisfies AS-145 — no custom rate limiter is being built.
- MCP at run: none
