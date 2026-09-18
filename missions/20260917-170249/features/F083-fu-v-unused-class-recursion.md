# F083: fix unused-class check to recurse into node children (AS-051)

**Milestone:** M3 follow-ups round 2
**Depends on:** F078

## Follow-up scope (from M3-scrutiny-2.md B-2)

`convert.ts`'s unused-class check only examines top-level nodes (`n.children` flatMap is shallow). Classes used only on descendant nodes are falsely reported as unused. The AS-141 integration test already has nested classed elements but never asserts `warnings`, so this goes undetected.

### Fix

Replace the shallow `flatMap` in convert.ts with a recursive walk:

```typescript
function collectUsedClasses(nodes: any[]): Set<string> {
  const used = new Set<string>()
  function walk(nodeList: any[]) {
    for (const n of nodeList) {
      for (const cls of (n.classes ?? [])) used.add(cls)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return used
}
```

Use `collectUsedClasses(emitResult.payload.payload.nodes)` instead of the current flatMap.

Also reuse the same recursive walk for the `fakeStyles` set (if that code still exists after F082 removes it — if F082 lands first, just the unused-class walk needs updating).

### Tests to add

- Class used only on a 3rd-level descendant → NO unused-class warning
- Class defined in CSS but used nowhere in HTML → unused-class warning  
- The AS-141 integration test: assert `result.warnings.filter(w => w.includes('not used')).length === 0`

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F083-handoff.md
Commit: "fix(AS-051): unused-class check recurses into all descendant nodes"
