# F107 — Fix AS-130: barrel guard must detect import/call sites, not text mentions

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-1 FU-A)_

## Problem

`tests/unit/m6-action-barrel-guard.test.ts` uses `new RegExp("\\b" + actionName + "\\b")` 
against raw file content. Comments and string literals count as "references". 
`changePageKind` is mentioned only in a comment in `lib/validation/architecture.ts:63` 
— deleting its real call site in `components/architecture/page-kind-selector.tsx` 
leaves the test GREEN.

## Fix

Rewrite the detection logic in `tests/unit/m6-action-barrel-guard.test.ts` to 
strip line comments (`// ...`) and block comments (`/* ... */`) and string literals 
from file content before scanning. Then scan for either:
- `import { ... actionName ... }` from the architecture barrel path
- `actionName(` as a call expression

The acceptance test: deleting the import + call of `changePageKind` from 
`components/architecture/page-kind-selector.tsx` while leaving the comment at 
`lib/validation/architecture.ts:63` intact must turn the test RED.

Additional requirements:
- Assert the parsed action count against an explicit expected number (fail if it drops)
- If `export *` appears in the barrel, `expect.fail` immediately
- No allowlist (AS-134 stays)

## Assertion covered

- **AS-130**: test now correctly detects only real import/call references, not comments

## Definition of done

- `npx vitest run tests/unit/m6-action-barrel-guard.test.ts` passes
- Mutation proof: temporarily remove import+call of `changePageKind` from 
  `components/architecture/page-kind-selector.tsx` (keeping the comment in architecture.ts) 
  → test FAILS → revert → test passes again
- Handoff includes mutation proof output
