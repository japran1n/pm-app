# F064: Fix AS-050 — fix haveAdminCreds env-loading order

**Milestone:** M5 follow-up (M5-scrutiny-1 major)
**Depends on:** F025

## Problem

`tests/setup/testing-library.ts:38-43` backfills dummy Supabase env vars before
`loadDotEnv()`. `loadDotEnv()` uses `!(key in process.env)` guard — so the real .env
values are rejected. `haveAdminCreds` is therefore always true (dummy values are present),
but the suite skips the tests because the "credentials" are dummy. The CI guard is dead code.

## Fix

Read `tests/setup/testing-library.ts`. Fix the loading order so:
1. `loadDotEnv()` runs FIRST (loads real .env values)
2. THEN backfill defaults only for keys that are still missing

OR: change `haveAdminCreds` to check for real values (not just presence of the key):
```ts
const haveAdminCreds = 
  process.env.SUPABASE_URL?.startsWith("https://") &&
  process.env.SUPABASE_SERVICE_KEY?.length > 20;
```

After the fix, `npx vitest run tests/integration/planner-block-write-rls.test.ts` should:
- Skip cleanly (with network-unavailable message) if Supabase is unreachable
- Pass if Supabase is reachable and credentials are real

## Gate

```bash
npx tsc --noEmit
npx vitest run tests/integration/planner-block-write-rls.test.ts
# Must skip cleanly (SKIP, not FAIL) when Supabase is unreachable
```

Write handoff to missions/20260920-124226/handoffs/F064-handoff.md with Status COMPLETE.
Commit before exiting.
