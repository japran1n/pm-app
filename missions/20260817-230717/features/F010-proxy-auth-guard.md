# F010: proxy auth guard

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 20 minutes
**Depends on:** F006

## Assertion IDs covered
- AS-001

## Draft scope
- proxy.ts redirects any unauthenticated request under /w/* to /sign-in

## Files (approximate)
app/proxy.ts

## Notes for clarification
Next.js 16: file/export renamed from middleware.ts/middleware to proxy.ts/proxy — do not use the old name.
- MCP at run: none
