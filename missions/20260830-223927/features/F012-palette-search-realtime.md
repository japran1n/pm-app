# F012: Palette search realtime reconcile

**Milestone:** M2 — Realtime expansion
**Estimated worker time:** 30 min
**Depends on:** none

## Assertion IDs covered
- AS-023: When a task title is changed by another user while the command palette is open, the search results reflect the new title without re-opening the palette.
- AS-024: When a task is deleted while the command palette is open, it is removed from search results without re-opening the palette.

## Draft scope
- Subscribe to realtime inside `command-palette.tsx` while palette is open; unsubscribe on close.
- On UPDATE event: find task in results by id, update title/status in state.
- On DELETE: remove from results.
- Use shared-topic-channel.

## Files (approximate)
`components/command/command-palette.tsx`; possibly extract `use-palette-search-realtime.ts`

## Notes
- MCP at run: none
- Read command-palette.tsx first — understand existing result state shape
- Only reconcile when query is non-empty (empty query shows recents, not search results)

---

## Clarified implementation (from clarifications/F012-clarification.md)

- Pattern: Extract as `use-palette-search-realtime.ts` hook to keep CommandPalette clean
- Data shape: Patches existing `PaletteSearchResults` state on incoming events
- State location: Component-local in CommandPalette
- API contract: On UPDATE: update matching task title/status. On DELETE: remove task.
- Failure handling: If subscription fails, results stay stale — acceptable; no error shown
- Validation: Check event payload has id before reconciling
- Performance budget: O(n) on result list; ~20 items max so negligible
- Access control: RLS at subscription level; no extra client check
- Touches: `components/command/command-palette.tsx` + new `use-palette-search-realtime.ts`

### Follow-up decisions
- Extract as `use-palette-search-realtime.ts` hook
- Topic: `tasks:${workspaceId}` (workspace-scoped, shared channel)
- Only reconcile if query.length > 0
- Subscribe in useEffect when query.length > 0; cleanup on query going to 0 or palette close
- Debounce: don't reconcile more than once per 100ms

## Definition of done

- **Primary success test:** Unit test: result title updates when UPDATE event arrives while palette open
- **Failure test:** Unit test: deleted task removed from results on DELETE event
- **Manual verification:** Open palette with query in tab A; rename task in tab B → title updates in A
- **Side-effect verification:** Reconcile doesn't fire new server search
- **Evidence artifact:** Test output (vitest)
