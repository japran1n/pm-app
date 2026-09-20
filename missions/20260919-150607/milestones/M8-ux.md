# M8 — UX / behavioural validation

Mission: `20260919-150607` · Milestone: M8 (F045–F048 + F116–F124)
Validator: ux-validator (Playwright, real Chromium, real Supabase project)
Date: 2026-09-20

## VERDICT: RED — one behavioural failure (AS-163/AS-164 in the default view)

## Environment notes

- `missions/20260919-150607/` still contains **no `validation-contract.md` and
  no `tech-decisions.md`** (same defect M5-ux flagged). Assertion wording was
  reconstructed from `plan.md`'s M8 table and the feature specs
  `features/F045…F048*.md`. "How to run" was reconstructed as `npm run dev`
  (Next 16.3.5 + Turbopack, `.env` → hosted Supabase).
- A dev server was **already listening on :3000** and was reused. It was not
  started by me and has been left running; my own `npm run dev` attempt exited
  immediately ("Another next dev server is already running") and started nothing.
- Test data: a throwaway workspace/user/project/3 components created via the
  admin key in `beforeAll` and deleted in `afterAll`. No project code was modified.

Harness (kept outside the repo test suite, archived as evidence):
`missions/20260919-150607/milestones/M8-ux-evidence/m8-ux.spec.ts` + `pw.config.ts`
Run: `npx playwright test -c <M8-ux-evidence/pw.config.ts>`

## Results

| Assertion | Verdict | Evidence | Reproduction |
|---|---|---|---|
| AS-152 | PASS | `M8-ux-evidence/01-dialog-default-static.png`; spec L109-126 | Board → "Add page" → dialog shows a "Page kind" label and a `Change page kind` selector button. |
| AS-153 | PASS | `M8-ux-evidence/01-dialog-default-static.png`; spec L124-127 | Same dialog, untouched: selector reads "Static" and its badge carries `data-page-kind="static"`. |
| AS-154 | PASS | `02-dialog-cms-selected.png`, `03-board-after-create.png`, `03b-page-menu-cms-kind.png`; spec L129-147 | In the dialog pick "CMS", fill name `M8 CMS Page` + slug, submit. Page appears on the board; the created row has `page_kind = "cms"` and the page's overflow menu shows the CMS badge (`[data-page-kind="cms"]`). |
| AS-155 | OUT-OF-SCOPE (internal) | — | `createPage` called without `page_kind` — server-action/schema level, no UI surface. Scrutiny's domain (F046/F117). |
| AS-156 | OUT-OF-SCOPE (internal) | — | `createPageSchema` optional field — schema level. |
| AS-159 | OUT-OF-SCOPE (internal) | — | Action exists + barrel export. |
| AS-160 | OUT-OF-SCOPE (internal) | — | Rejection of an incomplete id list is not reachable from the UI (the panel always sends the full list). |
| AS-161 | PARTIAL-OBSERVED (see AS-163) | `07-column-after-drag.png` | Positions are written: DB went `Alpha@100, Beta@200, Gamma@300` → `Beta@0, Alpha@1, Gamma@2` after a column-view drag. |
| AS-162 | PASS | `04-canvas-panel-initial.png`, `06-column-panel-initial.png`; spec L186-190, L221-223 | Components panel rows expose dnd-kit sortable wiring: each grip button `Reorder <name>` carries an `aria-roledescription` from `useSortable`, and a keyboard drag emits dnd-kit's live-region announcements ("Draggable item … was moved over droppable area …"). Present in both views. |
| AS-163 | **FAIL (default canvas view)** / PASS (column view) | FAIL: `05-canvas-after-drag.png`, `09-canvas-drag-failure.png`; PASS: `07-column-after-drag.png` | See below. |
| AS-164 | **FAIL (default canvas view)** / PASS (column view) | same | See below. |

## FAIL detail — AS-163 / AS-164 in the default (canvas) view

**Assertion:** dragging in the component panel changes the order of the
components (`onDragEnd` → `reorderComponents`), and a successful reorder
refreshes the view.

**Actual:** on `/w/<ws>/projects/<id>/architecture` in its **default** view
(`ArchitectureViewToggle` initialises `view = "canvas"`), dragging `M8 Alpha`
below `M8 Beta` produces an error toast **"Invalid UUID"**. The order on
screen is unchanged and the database is unchanged
(`["M8 Alpha@100","M8 Beta@200","M8 Gamma@300"]` before and after).

**Cause (code read, not applied):** `components/architecture/component-panel.tsx`
declares `projectId?: string` defaulting to `""` (L285, L293) and calls
`reorderComponents(projectId, nextOrder)` (L326). `board.tsx:392-395` passes
`projectId`; `canvas-board.tsx:483-487` **does not**, so the canvas view calls
the action with `""` and the action rejects on UUID validation. The drag itself,
the `arrayMove`, the transition and the error toast all behave correctly — only
the project id is missing.

**Reproduction:** open a project's Architecture tab (default canvas view) →
open the Components panel → focus a row's `Reorder …` grip → Space, ArrowDown,
Space → toast "Invalid UUID", nothing reorders.

**Why it is a milestone failure and not a nit:** canvas is the view a user
lands on. The feature is unreachable by default; it works only after switching
to Column view. In Column view the same flow reorders on screen, persists to
`page_components.position`, and survives a full reload
(`08-column-after-reload.png`), so AS-163/AS-164 are satisfied there.

## Suggested fixes (not applied — validator does not modify code)

1. Pass `projectId={projectId}` to `<ComponentPanel>` in
   `components/architecture/canvas-board.tsx:483`.
2. Make `projectId` a **required** prop on `ComponentPanel` and drop the
   `= ""` default, so the next omission is a type error instead of a runtime
   "Invalid UUID" toast. The `""` default is what turned a missing prop into a
   silent, user-visible failure.
3. Optional: reorder writes positions as `0,1,2` while seeded/other rows use
   `100,200,300`. Consistent, but worth a scrutiny look for collisions with
   code that appends at `max(position)+100`.

## Overall: RED — fix 1 above, then re-run `M8-ux-evidence/m8-ux.spec.ts`.
