# F112 — Fix AS-127: runtime-generated fixtures so no hardcoded map can pass

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-3 FU-6 blocker)_

## Problem

Static fixture files in `tests/fixtures/m6-check-guard/` can be bypassed by a
hardcoded implementation that keys on the constraint name and filename set.
The scrutiny validator proved this by writing a probe that reads zero bytes
of SQL content and still passes all 8 fixture tests.

## Fix

Replace the static fixture approach with runtime-generated SQL in the test itself.

In `tests/unit/m6-check-value-guard.test.ts`, replace the `parser fixtures` describe block:

```typescript
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

describe('parser fixtures — runtime generated (AS-127)', () => {
  // Generate unique names/values at runtime so no hardcoded map can pass
  const constraintName = `tasks_test_${randomUUID().replace(/-/g, '').slice(0, 8)}_check`;
  const v1 = `v_${randomUUID().slice(0, 8)}`;
  const v2 = `v_${randomUUID().slice(0, 8)}`;
  const v3 = `v_${randomUUID().slice(0, 8)}`;
  
  let tmpDir: string;
  
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'm6-check-guard-'));
  });
  
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  
  it('parses IN(...) form', () => {
    writeFileSync(path.join(tmpDir, '01_initial.sql'),
      `alter table public.tasks add constraint ${constraintName} check (kind in ('${v1}', '${v2}'));`
    );
    const result = findLastCheckConstraintValues(constraintName, tmpDir);
    expect(new Set(result)).toEqual(new Set([v1, v2]));
    expect(result.length).toBe(2);
  });
  
  it('picks latest migration (redefinition via IN)', () => {
    writeFileSync(path.join(tmpDir, '01_initial.sql'),
      `alter table public.tasks add constraint ${constraintName} check (kind in ('${v1}', '${v2}'));`
    );
    writeFileSync(path.join(tmpDir, '02_widen.sql'),
      `alter table public.tasks drop constraint if exists ${constraintName};
       alter table public.tasks add constraint ${constraintName} check (kind in ('${v1}', '${v2}', '${v3}'));`
    );
    const result = findLastCheckConstraintValues(constraintName, tmpDir);
    expect(new Set(result)).toEqual(new Set([v1, v2, v3]));
    expect(result.length).toBe(3);
  });
  
  it('parses = ANY (ARRAY[...]) form', () => {
    writeFileSync(path.join(tmpDir, '01_any.sql'),
      `alter table public.tasks add constraint ${constraintName} check (kind = any (array['${v1}', '${v2}', '${v3}']));`
    );
    const result = findLastCheckConstraintValues(constraintName, tmpDir);
    expect(new Set(result)).toEqual(new Set([v1, v2, v3]));
    expect(result.length).toBe(3);
  });
  
  it('throws when last mention is a drop', () => {
    writeFileSync(path.join(tmpDir, '01_initial.sql'),
      `alter table public.tasks add constraint ${constraintName} check (kind in ('${v1}'));`
    );
    writeFileSync(path.join(tmpDir, '02_drop.sql'),
      `alter table public.tasks drop constraint if exists ${constraintName};`
    );
    expect(() => findLastCheckConstraintValues(constraintName, tmpDir)).toThrow();
  });
  
  it('throws on unknown constraint name against real migrations', () => {
    const unknownName = `tasks_nonexistent_${randomUUID().replace(/-/g, '').slice(0, 8)}_check`;
    expect(() => findLastCheckConstraintValues(unknownName)).toThrow();
  });
});
```

Also DELETE the old static `tests/fixtures/m6-check-guard/` directory (it's no longer needed
and clutters the repo — it was only used for the now-replaced static fixtures).

## Assertion: AS-127

After the fix, run:
`npx vitest run tests/unit/m6-check-value-guard.test.ts --reporter=verbose 2>&1`
All tests must pass.

Commit: `feat(F112): AS-127 runtime-generated fixtures — no hardcoded map can pass`

Handoff: `missions/20260919-150607/handoffs/F112-handoff.md`
