# F001: record baseline

**Milestone:** M0  **Time:** 10 min  **Depends on:** none

## Assertions
(none — baseline evidence only)

## Clarified implementation
1. Run: `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx vitest run tests/unit`, `npm run migrations:check`
2. Count migrations: `ls supabase/migrations | wc -l`
3. Record HEAD sha: `git rev-parse HEAD`
4. Append all results to `missions/20260921-184313/run-log.md`

## Definition of done
- run-log.md contains tsc exit code, eslint exit code, vitest result, migrations:check exit code, migration count, HEAD sha
- Worker does NOT change any project files
