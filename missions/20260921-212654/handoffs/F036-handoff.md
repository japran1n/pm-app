# Handoff: F036 — switcher-vertical-cap-and-skeleton

## Status
COMPLETE

## Assertions covered
SB-030: PASS — width asserted against measured bell (within 1px) at 1280 and 375; height ceiling and skeleton footprint measured in Chromium.

## Files changed
components/workspace-switcher.tsx
components/nav/figures/skeletons.tsx
tests/unit/f007-sb030-switcher-width.test.ts
tests/unit/f017-suspense-fallback-footprint.test.tsx
tests/unit/f036-switcher-skeleton-footprint.test.ts
missions/20260921-212654/handoffs/F036-handoff.md

## Commands run
`npx vitest run tests/unit` (whole suite; failing files identical to baseline, f041-final-gate passed this run) (1 due to baseline failures)
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0)
Falsification runs (targeted vitest, mutation reverted each time): removing line-clamp-4 fails ceiling test (row 245.75 > 102); max-w-[170px] fails width test at 375px (170 vs 179); skeleton h-[30px] fails box test (30 vs 34).

## Decisions made
- SB-030 says the 40-char name is fully visible with no ellipsis, so line-clamp-2 is forbidden. Took the contract's fallback route: keep wrapping, clamp label at 4 lines (a 40-char name needs 3 at 256px), giving a documented ceiling: trigger <= 90px, header row <= 102px. Full name stays in `title`.
- Skeleton stays at 34px (single-line name); long names still grow the row (documented trade-off, recorded in comments); the 50px jump for 40-char names is NOT eliminated, only bounded.
- Width test: bell stub is now a non-empty 38px button with the real classes; expected = asideInner - row border - row padding - gap - measured bell width, within 1px. Dropped the tautological scrollWidth>clientWidth asserts; added a real labelHidden (scrollHeight>clientHeight) check that the clamp hides nothing. `title` asserted at 375px too.
- f017 skeleton class-regex test replaced by new f036-switcher-skeleton-footprint.test.ts (Chromium): fallback vs resolved row height and box height match within 1px for a short name; 40-char and 120-char names stay under the ceiling.

## Out-of-scope work needed
- Real NotificationBell is still stubbed (a 38px stand-in), not the actual component. Mobile bell size (max-md:size-11) is covered only in the 375px Sheet where the stub carries that class.
- No validation on workspace name length was found; the 4-line clamp is the only bound for very long names (they truncate visually beyond ~4 lines, full text in title).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose 4-line clamp over 2-line because SB-030 forbids hiding any of a 40-char name.

## Notes for the next worker
Test files matching the prefix f036/f017 include unrelated pre-existing failing files (baseline); run by full filename. On macOS use sed -i ''.
