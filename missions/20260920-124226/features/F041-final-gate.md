# F041: final gate

**Milestone:** M8 — Polish
**Estimated worker time:** 15 minutes
**Depends on:** F040

## Assertion IDs covered
- AS-073: `npx tsc --noEmit` reports no errors.
- AS-074: `npx eslint . --max-warnings=0` reports no errors and no warnings.
- AS-075: The unit test suite passes.
- AS-076: `npm run migrations:check` reports no drift against the remote database.
- AS-084: The mission adds no new runtime or development dependency to `package.json`.

## Draft scope
- tsc, eslint, vitest unit, migrations:check all clean.
- A package.json diff against the baseline proving no dependency was added.

## Files (approximate)
- `missions/<id>/run-log.md`

## Notes for clarification
AS-084 is checked by diff, not by assertion: a worker reaching for a package is the failure this catches.
