# F085: fix 3-level combo chain parentage (AS-117)

**Milestone:** M3 follow-ups round 2
**Depends on:** F076

## Follow-up scope (from M3-scrutiny-2.md B-5)

`emit.ts`'s combo parentage lookup uses the bare class name as the key into `idByKey`, but `idByKey` is keyed by css.ts's composite map key (e.g. `"a|b"` for `.a.b`). For a 3-level chain `.a.b.c`, the bare name `"b"` resolves to the standalone `.b` style, not the `.a.b` combo — so `.a.b.c` is attached to the wrong parent.

### The css.ts key format

In css.ts, combo classes are stored with a pipe-joined key: `.a.b` → key `"a|b"`, `.a.b.c` → key `"a|b|c"`. Standalone `.b` → key `"b"`.

### Fix

In `emit.ts`'s style assembly (where `immediateBase` is resolved):

1. When a style has `comboOf` (from parseCss), that array is the chain of all classes that precede this one (e.g. for `.a.b.c`, `comboOf = ["a", "b"]`).
2. The immediate base is the combo that omits the last class: key `comboOf.join("|")` (i.e. `"a|b"` for the `.a.b.c` case).
3. Look up `idByKey.get(comboOf.join("|"))` to get the base style's `_id`.
4. If not found (base class never defined in CSS), emit a warning instead of silently falling back to `""`.

Replace the `?? ""` fallback with a warning:
```typescript
const baseId = idByKey.get(rec.comboOf.join('|'))
if (!baseId) {
  warnings.push(`combo class "${rec.name}" references base "${rec.comboOf.join('.')}" which has no style definition — combo parentage skipped`)
  // set comb to "" so it's treated as a standalone
} else {
  style.comb = baseId
  // register in base's children array
}
```

### Tests to add

- 3-level chain `.a.b.c` on `<div class="a b c">`: assert `.a.b.c.comb` points to `.a.b._id` (not standalone `.b._id`), and `.a.b.children` contains `.a.b.c._id`
- Missing base (`.a.b.c` without `.a.b` defined): warning emitted, no crash, `comb: ""`
- 2-level chain (existing behavior): still works correctly

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F085-handoff.md
Commit: "fix(AS-117): 3-level combo chains resolve to correct base via composite key"
