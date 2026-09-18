# F076: emit Webflow envelope + combo-class parentage + id attribute + state variants

**Milestone:** M3 follow-ups round 1
**Depends on:** F018

## Clarified implementation (inherited from F018)

## Follow-up scope (from M3-scrutiny-1.md B-2, B-4, B-5, B-7)

Four related emit.ts fixes grouped here because they all touch the same walk.

### Fix 1: add `type: "@webflow/XscpData"` to the emitted object (AS-111)

In `emit.ts`, the object returned from `emitWebflow()` (and `emitWebflowFromSource()`) must include the `type` field:

```typescript
return {
  type: '@webflow/XscpData',
  payload: {
    nodes: nodeTree,
    styles: styleArray,
    assets: [],
    ix1: [],
    ix2: { interactions: [], events: [], actionLists: [] },
  },
}
```

Update the `WebflowPayload` TypeScript interface accordingly.

### Fix 2: populate base style `children` arrays with combo `_id`s (AS-117)

In `buildStyles` (or the style assembly loop), after all styles are created, do a second pass:

```typescript
for (const style of styleArray) {
  if (style.comb) {
    const base = styleArray.find(s => s._id === style.comb)
    if (base) {
      base.children = base.children ?? []
      if (!base.children.includes(style._id)) base.children.push(style._id)
    }
  }
}
```

### Fix 3: preserve `id` attributes on emitted nodes (AS-091)

Remove `id` from `RESERVED_ATTRS` (or stop suppressing it). Write the element's `id` onto the node as a `customAttributes` / `xattr` entry using the same pattern as `data-*` attributes:

```typescript
if (element.id) {
  xattr.push({ name: 'id', value: element.id })
}
```

Remove `emit.test.ts:60`'s assertion that `id` is absent — it currently protects the bug. Replace with an assertion that `id` round-trips.

### Fix 4: map pseudo-state variants onto Webflow state slots (AS-041)

In `emit.ts:101-110`, stop discarding variant keys that don't match breakpoints. Map Webflow-known pseudo-states to their variant key:

| CSS parsed key | Webflow variant key |
|---|---|
| `_hover` | `hover` |
| `_focus` | `focused` |
| `_pressed` or `_active` | `pressed` |
| `_placeholder` | `nthChild` (closest match) |

For each parseCss variant key that is a pseudo-state (not a breakpoint), add the declarations to the style's `variants` map under the Webflow key. Unrecognized pseudo-states emit a warning and are skipped.

Add tests:
- A `.btn:hover` input produces a reachable `hover` variant in the emitted style
- `<section id="hero">` emits an `id` xattr entry on the node
- A `.card.is-featured` input produces `card.children` containing the combo's `_id`
- `convert()` result top-level keys include `type`

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F076-handoff.md
Commit: "fix(AS-111,AS-091,AS-117,AS-041): emit type envelope, combo children, id attrs, hover variants"
