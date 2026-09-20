# F133 — Fix AS-180/181: COMPONENT_COLUMNS positive + dropped-column grep

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F129_

## Problem

**AS-180**: `COMPONENT_COLUMNS = "id"` passes — component name and position are silently lost. The test only asserts `description` is absent, not that `name` and `position` are present.

**AS-181**: The dropped-column half is unguarded. Adding `.select("id, client_visible")` on `architecture_node_meta` in any production file passes every test. The scan only checks for the removed action `setNodeMetaClientVisibility`, not for reads of the dropped columns.

## Fix

In `tests/unit/m9-regression.test.ts`:

### AS-180 positive assertion

After the existing `not.toContain("description")` for COMPONENT_COLUMNS, add:
```ts
expect(componentColumns).toContain("name")
expect(componentColumns).toContain("position")
```

These are the critical columns rendered by the board. `id` alone makes the board unusable.

If extraction uses regex on a double-quoted literal and the columns are in a template literal, adapt the extraction to handle both forms. Read `lib/queries/architecture.ts` carefully to find the exact form used.

### AS-181 dropped-column guard

Add a new scan (still in the AS-181 test block) that greps production files for references to the dropped columns qualified by their table:

```ts
// Dropped column: architecture_node_meta.client_visible
const nodeMetaClientVisibleUses = execSync(
  'grep -r "client_visible" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l 2>/dev/null || true',
  { encoding: "utf8" }
).split("\n").filter(Boolean)
  .filter(f => !f.includes(".test.") && !f.includes(".spec.") && !f.includes("missions/") && !f.includes("database.types.ts"))

// Note: client_visible is a live column on page_components and sections — 
// only references in the context of architecture_node_meta are dropped.
// Filter for files that also reference architecture_node_meta:
const qualifiedRefs = nodeMetaClientVisibleUses.filter(f => {
  const content = readFileSync(join(process.cwd(), f), "utf8")
  return content.includes("architecture_node_meta") && content.includes("client_visible")
})

expect(qualifiedRefs, `Files reference dropped column architecture_node_meta.client_visible: ${qualifiedRefs.join(", ")}`).toHaveLength(0)
```

### Verify

Run `npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` — pass.
Run `npx tsc --noEmit` — exit 0.

**Mutation verification**:
- Set `COMPONENT_COLUMNS` to `"id"` in lib/queries/architecture.ts → AS-180 must go red. Revert.
- Add `.select("client_visible")` to an `architecture_node_meta` query in lib/queries/architecture-details.ts → AS-181 must go red. Revert.

Commit and write handoff to `missions/20260919-150607/handoffs/F133-handoff.md`.
