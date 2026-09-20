# F129 — Fix AS-180/181: positive column assertions + tree-wide removed-action scan

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F051_

## Problem

**AS-180**: The test only has a negative regex that's unmatchable for the most likely regression (adding `description` back to `COMPONENT_COLUMNS`). The positive half — that `page_kind`, `page_slug` still appear — is never asserted.

**AS-181**: Only checks the barrel file (`lib/actions/architecture.ts`). A direct import bypasses it.

## Fix

In `tests/unit/m9-regression.test.ts`:

### AS-180 fix

Replace the `AS-180` test block:

1. Read `lib/queries/architecture.ts`
2. Find the `TASK_COLUMNS` / `BOARD_COLUMNS` constant (or whatever constant builds the select string for architecture tasks — likely a template literal or const string). Use a regex like `/const [A-Z_]+COLUMNS\s*=\s*`([^`]+)`/` or string search.
3. Assert the column string contains `page_kind` and `page_slug`.
4. Find the `COMPONENT_COLUMNS` / component select string.
5. Assert it does NOT contain `description` (this is the positive assertion — checks a specific column is absent from the specific component columns constant).
6. Remove the old unmatchable regex.

Verify by mutation: deleting `page_kind` from TASK_COLUMNS must turn the test red (today it does not).

### AS-181 fix

Replace the `AS-181` test block:

1. Use `execSync('grep -r "setNodeMetaClientVisibility" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l 2>/dev/null || true', { encoding: "utf8" })` to get a file list.
2. Filter out test files (`*.test.*`, `*.spec.*`), mission markdown, and handoff files.
3. Assert the filtered list is empty (no production file imports or calls this action).
4. Also assert that `lib/actions/architecture.ts` barrel does not re-export it (keeps the existing check as a subset).

Verify by mutation: adding `export { setNodeMetaClientVisibility } from "./architecture/node-meta"` to the barrel must turn the test red.

5. Run `npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` — pass.
6. Run `npx tsc --noEmit` — exit 0.
7. Commit and write handoff to `missions/20260919-150607/handoffs/F129-handoff.md`.
