# F006: supabase clients

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F003

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- Implement lib/supabase/client.ts (browser), server.ts (Server Components/Actions), and proxy.ts helper (Next 16 renamed middleware)
- Use @supabase/ssr cookie-based pattern

## Files (approximate)
lib/supabase/client.ts, lib/supabase/server.ts, lib/supabase/proxy-helpers.ts

## Notes for clarification
Follow tech-decisions.md exactly: file is proxy.ts (not middleware.ts), exported function is `proxy` (not `middleware`) — this is a Next.js 16 breaking change from the reference app's era.
- MCP at run: none
