# F030: Fix palette search clobber race (AS-023)

**Milestone:** M2
**Depends on:** F026

## Assertion IDs covered
- AS-023

## Root cause

`handleQueryChange` in `command-palette.tsx` calls `setResults(results)` which wholesale-replaces state. If a search response resolves AFTER a realtime patch has updated a task title, the search response overwrites the patched title. The realtime update is lost.

## Fix

Instead of replacing results wholesale on search response, MERGE the incoming search results with any realtime patches already applied. Options:

1. **Ref-based patch map**: maintain a `Map<id, Partial<PaletteItem>>` of realtime patches. When search results arrive, apply any pending patches to the incoming results before calling `setResults`. When the palette closes or query changes to empty, clear the patch map.

2. **Discriminated state**: keep search results and realtime patches as separate state. Derive display results by merging. Search responses update the base; realtime events update the overlay.

Pick the simpler approach. The key invariant: a realtime title patch must survive a search response that returns the same task with the old title.

Add a test in `tests/unit/palette-search-realtime.test.ts` that:
- Sets up search results
- Fires a realtime UPDATE changing a task title
- Then fires a "search response" (setResults with old title)
- Asserts the realtime-patched title is still shown (not reverted)

## Files
`components/command/command-palette.tsx`, `tests/unit/palette-search-realtime.test.ts`

## Definition of done
- AS-023: PASS — title patch survives subsequent search response
