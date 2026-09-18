# F081: reconcile wrapper-class emission and empty-nodes validator rule

**Milestone:** M3 follow-ups round 1
**Depends on:** F080

## Clarified implementation (inherited from F021/F075)

## Follow-up scope (from F080-handoff.md PARTIAL)

Two `convert.test.ts` tests remain failing after F080:

### Bug 1: `wrapper` class emitted by emit.ts fails AS-114 validator check

`emitWebflow` emits a structural `wrapper` class on the root node even when no CSS class named `wrapper` is defined. `validatePayload`'s AS-114 check then errors: "Node references class 'wrapper' with no matching style definition."

**Fix:** In `emit.ts`, stop emitting the structural `wrapper` class on nodes when it has no backing CSS definition. Look at where the `wrapper` class is added to the node's `classes` array and only add it if a style with that name was actually generated from the CSS. 

Alternatively: rename the structural wrapper to an internal concept that doesn't appear in the `classes` array of emitted nodes (Webflow nodes don't need a structural wrapper class — it was likely added in error).

Choose the approach that makes the failing test pass: `convert > converts HTML only (no CSS) into a valid payload`.

### Bug 2: empty-nodes validator rule conflicts with empty-HTML contract

`validator.ts` unconditionally errors when `payload.nodes` is empty (`payload.nodes must not be empty`). But `convert("", "")` is expected to return `errors: []` and a valid payload with `nodes: []`.

**Fix:** Change the empty-nodes rule to be conditional — only error when the INPUT was not empty. The simplest approach: pass an `options` object to `validatePayload` with an `allowEmptyNodes?: boolean` flag, and set it to `true` when `convert()` detects the HTML input was empty (after trimming):

```typescript
const allowEmptyNodes = html.trim() === ''
const validation = validatePayload({ ...inner, type }, { allowEmptyNodes })
```

In `validator.ts`:
```typescript
export function validatePayload(payload: XscpPayload, opts?: { allowEmptyNodes?: boolean }) {
  // ...
  if (!opts?.allowEmptyNodes && payload.nodes.length === 0) {
    errors.push('payload.nodes must not be empty')
  }
}
```

After both fixes, run:

Run: npx vitest run lib/webflow-converter/
Run: npx tsc --noEmit
Run: npm run lint

All tests must pass (346/346 or more).

Write handoff to: missions/20260917-170249/handoffs/F081-handoff.md
Commit: "fix: remove spurious wrapper class; allow empty nodes for empty HTML input"
