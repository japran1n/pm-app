# Handoff: F062 — Fix AS-043 — find real drag implementation; fix vacuous test

## Status
COMPLETE

## Assertions covered
AS-043: PASS — `tests/unit/f022-no-drag-other-blocks.test.tsx` now renders the LIVE `WeekTimeGrid`/`WeekBlockChip` component and asserts its resize-handle drag surface is gated to the block owner; mutation `isOwnBlock` → always `true` fails the "other member's block" test.

## Files changed
tests/unit/f022-no-drag-other-blocks.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0` (0)
`ALLOW_HOSTED_TESTS=1 npx vitest run tests/unit/f022-no-drag-other-blocks.test.tsx` (0, 2 passed)
`ALLOW_HOSTED_TESTS=1 npx vitest run tests/unit/f022-no-drag-other-blocks.test.tsx` with `isOwnBlock` mutated to `return true` (1 failed as required, reverted immediately after)

## Decisions made
- Investigated `components/calendar/week-time-grid.tsx` end to end and confirmed `WeekBlockChip` (the actual Planner block component, rendered by the exported `WeekTimeGrid`) has **no drag-to-move gesture at all** — no dnd-kit, no pointer-based "move" handler. The only pointer-drag affordance on an existing block is its two resize handles (`calendar-week-resize-start-*` / `-end-*`), which retime the block by dragging an edge. Those are already gated in production via `canResize={canDrag && isOwnBlock(block, currentUserId)}` (added by F021, same call site F022 was supposed to gate for AS-043 but never did since it modified the wrong, dead component).
- Rewrote `tests/unit/f022-no-drag-other-blocks.test.tsx` to render the real `WeekTimeGrid` export (same pattern as `tests/unit/f021-no-resize-other-blocks.test.tsx`) instead of instantiating the dead `CalendarBlockChip` directly, and to assert on the resize-handle testids — the actual drag surface AS-043 is about — rather than a synthetic `data-draggable`/`cursor-grab` class pair that doesn't exist on the live component.
- No production code change was needed: `canResize`'s gate in `week-time-grid.tsx` and `isOwnBlock` in `lib/calendar/ownership.ts` (`block.userId === currentUserId`) were already correct; only the test was pointed at the wrong (dead) component. Verified this is genuinely the fix by mutating `isOwnBlock` to always return `true` and confirming the new test fails.
- Left `components/calendar/calendar-block-chip.tsx` and the pre-existing dead component itself untouched — out of scope per the feature spec, which only asks to gate/verify the live drag surface and fix the vacuous test.

## Out-of-scope work needed
`components/calendar/calendar-block-chip.tsx` (the dnd-kit-based `CalendarBlockChip`) is confirmed dead code with no production import (its only consumer, `calendar-day-grid.tsx`, was deleted in F057). It still exists in the repo along with its own drag logic. A future cleanup feature could delete it entirely if nothing else references it — not done here since the spec for F062 only asked to fix the test/gate, not perform dead-code removal, and F057/F058 (which already did related dead-code removal for the month view) are the more natural owners of that call.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Modeled the new test directly on `tests/unit/f021-no-resize-other-blocks.test.tsx` (same `WeekTimeGrid` render pattern, same mocks for `@/lib/actions/calendar-blocks` and `@/components/auth/membership-provider`) since AS-042 (F021) and AS-043 (F022/F062) are both gating the exact same `canResize` boolean in `week-time-grid.tsx` — there is no distinct "move" gesture to test separately in the live component.

## Notes for the next worker
- `ALLOW_HOSTED_TESTS=1` is required to run this suite locally/in this sandbox — the test setup (`tests/setup/testing-library.ts`) refuses to run against the hosted Supabase project referenced in `.env` (`qcipqonnqajmazdbysow.supabase.co`) unless that env var is set or a local Supabase stack is running. No MCP tools were needed for this feature (pure component/unit-test fix, no live external-service state touched).
