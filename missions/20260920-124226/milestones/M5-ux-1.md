# M5 UX validation — Other members' blocks are read-only

Mission: 20260920-124226 · Run: M5-ux-1 · Date: 2026-09-20
App: Next.js dev server, `npm run dev`, http://localhost:3000

## Test fixture

Seeded via the Supabase admin client (same pattern as `tests/e2e/board-reorder.spec.ts`):

- Workspace `m5ux-1789915983011` (id `0b7dc266-e69b-41d6-904e-cd881c8a3358`)
- Member A ("me", signed in): `274025fa-adba-467f-9a4c-e9bcf30eff2b` — block `b604cf50-…` "MINE Own Block" 09:00–10:00Z, Sun 20 Sep
- Member B ("other"): `b815fe5b-023f-465e-9936-ea666573bf5a` — block `abba3245-…` "THEIRS Other Block" 13:00–14:00Z, Sun 20 Sep

Both members are `active` in `workspace_members`, so the Planner fetches both blocks
(`blockUserIds = workspaceMembers.active`). Auth: real `auth.admin.generateLink`
magic link, tokens loaded into the `sb-<ref>-auth-token` cookie.

Route exercised: `/w/m5ux-1789915983011/calendar`

## Results

| ID | Verdict | Evidence | Reproduction |
|----|---------|----------|--------------|
| AS-042 | PASS | `missions/20260920-124226/milestones/evidence/M5-1-grid-both-blocks.png`, `…/M5-dom-probe.json`, `…/M5-8-other-block-edge-drag-noop.png` | Sign in as member A, open the calendar week containing both blocks. Own chip renders `calendar-week-resize-start-<id>` and `calendar-week-resize-end-<id>`; the other member's chip renders neither. Press-dragging the other block's bottom edge 100px down leaves the label at 3:00 PM–4:00 PM. |
| AS-043 | PASS | `…/M5-dom-probe.json`, `…/M5-db-state-after.json` | Press the centre of "THEIRS Other Block", drag 180px down, release. Chip label unchanged (3:00 PM–4:00 PM before and after) and `calendar_blocks.starts_at/ends_at` for `abba3245-…` still `2026-09-20T13:00:00+00:00` / `14:00:00+00:00`. The week-grid chip carries no dnd listeners and `canMove = canDrag && isOwnBlock(...)` is false for the agenda chip variant. |
| AS-044 | PASS | `…/M5-2-other-block-readonly-popover.png`, `…/M5-dom-probe.json` | Click "THEIRS Other Block". A popover opens showing Title="THEIRS Other Block", Start=15:00, End=16:00, the client-presentation checkbox and the colour row — every input `disabled` (title also `readOnly`), all 8 colour swatches `disabled`, and the footer reads "You can only edit or delete your own blocks." (`data-testid="calendar-block-readonly-note"`). No submit control exists in the popover. |
| AS-045 | PASS | `…/M5-2-other-block-readonly-popover.png`, contrast: `…/M5-3-own-block-editable-popover.png` | Same popover as AS-044: enumerating every `button`/`[type=submit]` inside the dialog yields only the 8 disabled colour swatches — no Delete, no Save. Opening the signed-in member's own block in the same session yields a popover whose text ends "…Color / Delete / Save", confirming the difference is ownership, not a missing feature. |
| AS-047 | INCONCLUSIVE (not reachable) | `…/M5-1-grid-both-blocks.png`, code note below | The week grid renders one column per **day**, not per person. `week-time-grid.tsx:478` computes `const columnUserId = day.userId ?? currentUserId`, and `CalendarWeekDay` has no `userId` producer in M5 — the per-person stacked layout (`components/calendar/stacked-planner.tsx`, `stacked-person-row.tsx`) is M7 work and those files do not exist yet. There is therefore no column or row belonging to another member anywhere in the running UI, so the assertion cannot be exercised from the browser. The gate itself (`canCreateInColumn` → `isOwnColumn`) is wired into both the "+" affordance render condition (line ~522) and `handleColumnPointerDown`. Re-run this assertion at M7. |
| AS-048 | INCONCLUSIVE (not reachable) | same as AS-047 | Same reason: no other-member column/row is renderable in M5. Drag-to-create was exercised only against the signed-in member's own column (see AS-049). |
| AS-049 | PASS | `…/M5-4-own-column-add-affordance.png`, `…/M5-5-own-column-create-popover.png`, `…/M5-6-own-create-persisted.png`, `…/M5-7-own-column-drag-create.png`, `…/M5-db-state-after.json` | **Click path:** hover a half-hour slot in an own day column → the dashed "+ 08:00" affordance (`calendar-week-add-slot-<date>`) appears → click it → `calendar-week-create-popover` opens → type "M5 UX Created Block" → Add block → after a full page reload the block is on the grid and row `7520c0a1-…` exists in `calendar_blocks` with `user_id = 274025fa-…`. **Drag path:** press on the "+" affordance and drag 70px down → `calendar-week-drag-preview` renders during the gesture → release → create popover opens pre-filled 11:45–13:00 from the dragged range. |

## Observations (not assertion failures)

- Drag-to-create only starts from the hover "+" affordance, not from bare grid surface: the day-column `div` has `onPointerMove`/`onPointerUp`/`onMouseMove`/`onMouseLeave` but deliberately no `onPointerDown` (`week-time-grid.tsx` ~line 495). This matches the in-code comment "a plain click anywhere else on the column no longer opens the create popover" and still satisfies AS-049's "clicking or dragging", but it means a press-drag begun on empty grid does nothing. Worth confirming this is the intended product behaviour before M7 puts several columns per day on screen.
- The read-only popover does not name the block's owner. AS-044 only requires a read-only detail view, so this is not a failure, but "THEIRS Other Block" gives the viewer no indication of whose block it is.

## Suggested fixes

None required for the assertions in scope. No code was modified.

## Cleanup

Test workspace `m5ux-1789915983011`, its two users and three calendar blocks were left in
place so this run is reproducible; delete them with the admin client when no longer needed.
