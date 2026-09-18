# F086: fix AS-041 remaining states, breakpoint fold, case-insensitive attributes

**Milestone:** M3 follow-ups round 3
**Depends on:** F084, F085

## Follow-up scope (from M3-scrutiny-3.md B-1, B-2, B-3)

All three blockers are in lib/webflow-converter/emit.ts.

---

### Fix B-3 first (prerequisite for reliable testing): case-insensitive attribute lookup (AS-091)

`node-html-parser` preserves source attribute case. HTML attribute names are case-insensitive. `<div ID="Hero" CLASS="a">` currently loses both id and all classes silently.

**Fix:** In `walkElement` (or wherever attributes are first accessed), build a lowercased attribute map:

```typescript
const attrs: Record<string, string> = {}
for (const [k, v] of Object.entries(element.attributes)) {
  attrs[k.toLowerCase()] = v
}
```

Use this `attrs` object for all subsequent lookups: `attrs.id`, `attrs.class`, `attrs.style`, `attrs.type`, `attrs.href`, and the `data-` prefix filter. Also pass the lowercased attrs to `getWebflowType`.

Also lowercase `RESERVED_ATTRS` entries if they aren't already.

Add tests with uppercase `ID`, `CLASS`, `STYLE`, `HREF`, `DATA-FOO` — assert they are handled identically to lowercase.

---

### Fix B-2: breakpoint+state fold must not clobber base or overwrite (AS-041)

`emit.ts:119-123` direct-assigns `variants[breakpointPrefix]`, which overwrites any earlier fold into the same key. The current fold also writes hover declarations into the unconditional slot.

**Fix:** Change the variant accumulation to use a Map of declaration objects, not string concatenation:

```typescript
// Accumulate per-key declarations as Record<string,string>
const variantDecls: Record<string, Record<string, string>> = {}

for (const [variantKey, decls] of Object.entries(rec.variants)) {
  if (isBreakpointKey(variantKey)) {
    // direct breakpoint declarations
    variantDecls[variantKey] = { ...variantDecls[variantKey], ...decls }
  } else if (isCompositeKey(variantKey)) {
    // e.g. "medium_hover" — fold into breakpoint unconditional with warning
    const bpPrefix = extractBreakpoint(variantKey)
    // Do NOT merge hover-only declarations into the unconditional breakpoint slot
    // Instead, warn and skip — Webflow doesn't support per-breakpoint hover in class editor
    warnings.push(`"${variantKey}" on .${rec.name}: per-breakpoint pseudo-state is not representable in Webflow — declarations skipped`)
    // Do NOT write them to variantDecls[bpPrefix]
  } else {
    // pure pseudo-state key
    const wfKey = PSEUDO_STATE_TO_WEBFLOW[variantKey]
    if (wfKey) {
      variantDecls[wfKey] = { ...variantDecls[wfKey], ...decls }
    }
  }
}

// Stringify each accumulated slot
const variants: Record<string, {styleLess: string}> = {}
for (const [k, decls] of Object.entries(variantDecls)) {
  variants[k] = { styleLess: Object.entries(decls).map(([p,v]) => `${p}: ${v};`).join(' ') }
}
```

Tests:
- Two `@media` rules for same breakpoint in either order → both land in `variants.medium`, no duplicate property
- `:hover` inside `@media` → warning emitted, NOT in medium.styleLess unconditionally
- `@media .btn` + `@media .btn:hover` → medium.styleLess has only base declarations

---

### Fix B-1: remaining AS-041 pseudo-states (AS-041)

The validation contract AS-041 lists these 8 states. Currently only 3 have Webflow mappings. The validator says the tests that assert "no slot" for 5 states are wrong.

**Known Webflow clipboard slot names** (from the Designer's own clipboard format):
- `:hover` → `"hover"`
- `:active` → `"pressed"`
- `:focus` → `"focused"`
- `:focus-visible` → `"focused"` (Webflow treats focus-visible the same as focus)
- `::before` → `"before"` 
- `::after` → `"after"`
- `:visited` → no Webflow slot (link states are separate; warn and skip)
- `::placeholder` → no Webflow slot (warn and skip)

Extend `PSEUDO_STATE_TO_WEBFLOW`:

```typescript
const PSEUDO_STATE_TO_WEBFLOW: Record<string, string> = {
  '_hover': 'hover',
  '_focus': 'focused',
  '_focus-visible': 'focused',  // merged with :focus
  '_active': 'pressed',
  '_pressed': 'pressed',
  '_before': 'before',
  '_after': 'after',
  // _visited: no slot → fall through to warning
  // _placeholder: no slot → fall through to warning
}
```

Also update `WebflowStyleVariants` interface to include `before` and `after` keys.

**Delete the 5 incorrect tests** at `emit.test.ts:220-251` that assert these states produce `Object.keys(style.variants).toHaveLength(0)` — they assert the inverse of AS-041.

**Replace** them with:
- `:focus-visible` → `focused` slot (styleLess present)
- `::before` → `before` slot (styleLess present)
- `::after` → `after` slot (styleLess present)
- `:visited` → warning emitted, no variant slot (limitation — Webflow has no visited slot)
- `::placeholder` → warning emitted, no variant slot

---

### After all fixes

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

All tests must pass.

Write handoff to: missions/20260917-170249/handoffs/F086-handoff.md
Commit: "fix(AS-041,AS-091): case-insensitive attrs, merge breakpoint decls, map ::before/::after/focus-visible"
