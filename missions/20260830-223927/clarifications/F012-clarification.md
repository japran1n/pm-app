# F012 Clarification — Palette search realtime reconcile

_Generated: 2026-08-30T23:00:00Z_  _Mode: accept-and-continue (★ defaults)_

## Round A

1. **Implementation pattern** ★ Subscribe to realtime inside `command-palette.tsx` while the palette is open; unsubscribe on close
2. **Data shape** ★ Existing `PaletteSearchResults` state gets patched on incoming events
3. **State location** ★ Component-local in CommandPalette; no new context needed
4. **API contract** ★ On UPDATE event: find task in results by id, update title/status. On DELETE: remove from results.
5. **Failure handling** ★ If subscription fails, results stay stale — acceptable; no error shown
6. **Empty state** ★ No results → no reconcile needed
7. **Validation** ★ Check event payload has id before reconciling
8. **Performance budget** ★ Reconcile is O(n) on result list; results capped at ~20 items so negligible
9. **Access control** ★ RLS at subscription level; no extra client check
10. **Touches** ★ `components/command/command-palette.tsx`; possibly extract `use-palette-search-realtime.ts`

## Round B — Follow-ups

11. ★ Extract as `use-palette-search-realtime.ts` hook to keep CommandPalette clean
12. ★ Topic: reuse `tasks:${workspaceId}` workspace-scoped channel (shared with calendar if both open)
13. ★ Only reconcile if query is non-empty (empty query shows recents, not search results)
14. ★ Subscribe in `useEffect` when `query.length > 0`; cleanup on query going to 0 or palette close
15. ★ Debounce: don't reconcile more than once per 100ms (batch rapid events)

## Definition of done

16. **Primary success test** ★ Unit test: result title updates when UPDATE event arrives while palette is open
17. **Failure test** ★ Unit test: deleted task removed from results on DELETE event
18. **Manual verification** ★ Open palette with query in tab A; in tab B rename that task — title updates in A's results
19. **Side-effect verification** ★ Reconcile doesn't fire new server search (no extra network requests)
20. **Evidence artifact** ★ Test output (vitest)
