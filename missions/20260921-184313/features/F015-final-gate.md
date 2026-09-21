# F015: final gate verification

**Milestone:** M5  **Time:** 10 min  **Depends on:** F014

## Assertions
AS-111, AS-112, AS-113, AS-005

## Clarified implementation
1. `npx tsc --noEmit` → must exit 0
2. `npx eslint . --max-warnings=0` → must exit 0
3. `npx vitest run tests/unit` → record result; must be no new failures vs baseline
4. `npm run migrations:check` → must exit 0
5. `ls supabase/migrations | wc -l` → count must equal baseline (AS-005)
6. Append all results to `missions/20260921-184313/run-log.md`
7. Commit with message: "feat(dashboard): worker-first home dashboard redesign"

## Definition of done
- All four checks pass
- run-log.md updated
- Commit exists on current branch
