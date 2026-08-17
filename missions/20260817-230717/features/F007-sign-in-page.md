# F007: sign in page

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F006

## Assertion IDs covered
- AS-002

## Draft scope
- /sign-in route with email input, magic-link request via Supabase Auth
- Success state confirms email was sent

## Files (approximate)
app/(auth)/sign-in/page.tsx

## Notes for clarification
Rely on Supabase Auth's built-in magic-link rate limiting rather than building custom throttling — document this reliance explicitly in the handoff (covers AS-145).
- MCP at run: none
