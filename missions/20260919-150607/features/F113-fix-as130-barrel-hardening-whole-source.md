# F113 — Fix AS-130: barrel hardening must check whole source, not per line

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-3 FU-7 blocker)_

## Problem

F111's `export *` / `export default` / bare-`export{}` hard-fail runs inside
`for (const line of stripped.split("\n"))`, so multi-line forms escape:

```ts
export {
  zombieAction,
};
```
or `export async function zombieAction() {}` yields 0 names, 0 hard-fails,
and `EXPECTED_ACTION_COUNT` stays satisfied — the action is silently unguarded.

## Fix

Read `tests/unit/m6-action-barrel-guard.test.ts` first.

Replace the per-line classification in `parseBarrelExports` with whole-source analysis:

```typescript
function parseBarrelExports(src: string): string[] {
  const stripped = stripCommentsAndStrings(src);
  
  // Collect all export { X, Y } from "path" blocks (the ONLY allowed form)
  const namedReExports: string[] = [];
  const reExportRe = /export\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g;
  let m: RegExpExecArray | null;
  while ((m = reExportRe.exec(stripped)) !== null) {
    const names = m[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('type ') && !s.includes(' as '));
    namedReExports.push(...names);
  }
  
  // Remove the matched re-export blocks from source to find leftover exports
  const withoutReExports = stripped.replace(reExportRe, '');
  
  // Also allow: export type { ... } from "..."
  const withoutTypeExports = withoutReExports.replace(
    /export\s+type\s*\{[^}]+\}\s*from\s*["'][^"']+["']/g, ''
  );
  
  // Any remaining `export` keyword is forbidden
  const forbiddenExportRe = /\bexport\b/g;
  const forbiddenMatches = withoutTypeExports.match(forbiddenExportRe);
  if (forbiddenMatches && forbiddenMatches.length > 0) {
    // Find the actual context
    const idx = withoutTypeExports.search(/\bexport\b/);
    const snippet = withoutTypeExports.slice(Math.max(0, idx - 20), idx + 60);
    expect.fail(
      `Barrel contains a disallowed export form: ...${snippet}...\n` +
      `Only "export { name } from '...'" is allowed. ` +
      `Found ${forbiddenMatches.length} disallowed export(s).`
    );
  }
  
  return namedReExports;
}
```

## Mutation proof required

1. Add `export async function zombieAction() { return null; }` to `lib/actions/architecture.ts`
2. Run: `npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose 2>&1`
3. Must FAIL with a message about disallowed export form
4. Revert: `git checkout -- lib/actions/architecture.ts`
5. Run again — must PASS

Also test multi-line export block:
1. Add these lines to `lib/actions/architecture.ts`:
   ```ts
   export {
     zombieMultiline,
   };
   ```
2. Run test — must FAIL
3. Revert

## Assertion: AS-130

Commit: `feat(F113): fix AS-130 barrel hardening whole-source export check`

Handoff: `missions/20260919-150607/handoffs/F113-handoff.md`
Include both mutation proofs.
