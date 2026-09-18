# F075: complete payload validator — missing rules for AS-111/112/114/116/118

**Milestone:** M3 follow-ups round 1
**Depends on:** F020

## Clarified implementation (inherited from F020)

## Follow-up scope (from M3-scrutiny-1.md B-2)

`validator.ts` only covers about a third of F020's spec. Five rules are missing.

### Fix 1: assert payload carries `type: "@webflow/XscpData"`

In `validatePayload`, add an early check:

```typescript
if (!payload || typeof payload !== 'object' || (payload as any).type !== '@webflow/XscpData') {
  errors.push('payload missing type: "@webflow/XscpData"')
}
```

### Fix 2: reject empty `nodes` array (AS-112)

After the array-shape check, add:

```typescript
if (payload.payload.nodes.length === 0) {
  errors.push('payload.nodes must not be empty')
}
```

Delete `validator.test.ts`'s `"empty nodes array is a valid empty document"` test — it asserts the inverse of AS-112.

### Fix 3: verify every node class name resolves to a style entry (AS-114)

```typescript
const styleIds = new Set(payload.payload.styles.map((s: any) => s._id))
for (const node of payload.payload.nodes) {
  for (const cls of (node.classes ?? [])) {
    if (!styleIds.has(cls)) {
      errors.push(`node references class "${cls}" with no matching style _id`)
    }
  }
}
```

### Fix 4: detect duplicate style `_id`s (AS-116)

Alongside the existing duplicate node-id check:

```typescript
const seenStyleIds = new Set<string>()
for (const style of payload.payload.styles) {
  if (!style._id) { errors.push('style missing _id'); continue }
  if (seenStyleIds.has(style._id)) errors.push(`duplicate style _id: ${style._id}`)
  seenStyleIds.add(style._id)
}
```

### Fix 5: verify combo classes appear in their base's `children` array (AS-117 prerequisite)

After iterating styles:

```typescript
const styleMap = new Map(payload.payload.styles.map((s: any) => [s._id, s]))
for (const style of payload.payload.styles) {
  if (style.comb) {
    const base = styleMap.get(style.comb)
    if (!base) {
      errors.push(`combo style "${style._id}" references unknown base "${style.comb}"`)
    } else if (!Array.isArray(base.children) || !base.children.includes(style._id)) {
      errors.push(`combo style "${style._id}" not registered in base "${style.comb}".children`)
    }
  }
}
```

### Fix 6: correct assertion ID labels in all `validator.test.ts` test names

Every test name in the file is mislabelled (off by 1+). Fix them to match the actual assertion IDs being tested.

### Tests to add

Each new rule gets:
- A test that constructs a deliberately-broken payload and asserts the specific error message
- A test that a `convert()` call returning that shape gives `payload: null`

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F075-handoff.md
Commit: "fix(AS-111,AS-112,AS-114,AS-116,AS-118): complete validatePayload with all missing rules"
