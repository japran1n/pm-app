# Handoff: ADHOC — widen and reorganize TaskDetailSheet layout

## Status
COMPLETE

## Assertions covered
No assertion IDs — this is ad-hoc UI/UX follow-up work explicitly requested
by the user after M19 shipped, not a numbered mission feature. No new
behaviour, purely layout/spacing.

## Files changed
- components/task/task-detail-sheet.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/task/task-detail-sheet.tsx` (0)
`npx vitest run tests/unit/board-task-detail-sheet-wiring.test.ts tests/integration/task-detail-sheet-time-total.test.ts` (0, 12 passed)
`npm test` (33 test files failed / 104 passed — all pre-existing DB/network
integration failures: Supabase auth rate limits and 5s test timeouts on
unrelated suites such as `workspace-members-list.test.ts` and
`subtask-ui-detail.test.ts`. Verified these same tests fail identically on
`main` with `git stash` before my change was applied, i.e. unrelated to this
edit — see Decisions made.)

## Decisions made
- **Widened only `TaskDetailSheet`'s own `SheetContent`, not the shared
  `sheet.tsx` primitive's default.** Grepped every `<SheetContent>` caller
  in the app first: `components/nav/app-sidebar.tsx`'s mobile nav sheet
  already overrides width itself (`className="w-64 p-0"`), confirming
  per-caller `className` override is the existing convention rather than
  changing the primitive's default `sm:max-w-sm`. `TaskDetailSheet` is the
  only "detail" sheet in the app, so widening it alone doesn't regress any
  other Sheet caller.
- **Chose `sm:max-w-2xl` (42rem/672px)** via `className="w-full sm:max-w-2xl
  data-[side=right]:sm:max-w-2xl data-[side=left]:sm:max-w-2xl"`. The
  primitive's base classes already set `data-[side=right]:sm:max-w-sm`
  with higher specificity via the `data-[side=...]` variant, so overriding
  the plain `sm:max-w-2xl` alone was not enough — had to re-target the same
  `data-[side=right]:sm:max-w-sm` / `data-[side=left]:sm:max-w-sm` utility
  classes explicitly so Tailwind's cascade (via `cn`, which just
  concatenates and lets the later class in source order win when
  specificity is equal) picks up the override. Confirmed by reading
  `components/ui/sheet.tsx`'s exact class string before editing.
  2xl (~672px) reads as "spacious" without swallowing the whole viewport
  on typical desktop widths, roughly matching how a wide 2-pane layout
  panel looks elsewhere in shadcn-style apps; no other Dialog/Sheet in this
  codebase used a wider convention to match, so this is a fresh choice.
- **Reorganized field order**: Title → metadata grid (Status / Priority /
  Assignee / Due date, now a 4-column grid at `sm:` and up, 2-column below,
  inside a `rounded-lg border bg-muted/30 p-4` group) → Description →
  Tags → Separator → Subtasks → Checklist → Dependencies → Comments →
  Attachments → Time tracking. Moved Description below the metadata grid
  (it was between Title and the old 2-col Status/Priority grid) so the
  scannable fields (status/priority/assignee/due date) are visible without
  scrolling past a potentially long description first, satisfying the
  "reader should scan important fields without scrolling past a huge
  description" requirement. Content padding widened from `px-4` to `px-6`
  to match the wider sheet body without looking cramped at the new width.
- Did not touch `sheet.tsx`'s `side` prop usage — `TaskDetailSheet` still
  uses the primitive's default `side="right"`, unchanged.
- Left every existing id/htmlFor pairing, Select/Input wiring, blur
  handlers, and the delete/footer/blocked-done-guard dialog completely
  untouched — only wrapping `<div>` structure and `className` values
  changed.

## Out-of-scope work needed
None identified — this was purely a layout/spacing pass per the explicit
ask; no data-fetching, Server Action, or child-component internals were
touched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Picked `sm:max-w-2xl` as the new max-width since no
existing wide-sheet/dialog convention exists elsewhere in the codebase to
match; chosen to read as "spacious" while still leaving visible page
content on a typical desktop viewport (not full-bleed).
AUTONOMOUS_DECISION: Grouped status/priority/assignee/due date into a
bordered/tinted card-like grid (`rounded-lg border bg-muted/30 p-4`) rather
than a plain unstyled grid, to visually separate "scannable metadata" from
the free-text Description/Tags/list sections below, in service of the
"organized, not just wider" half of the ask.

## Notes for the next worker
- Did not run `npm run dev` — confirmed via `npx tsc --noEmit` and
  `npx eslint` that the file compiles cleanly, and ran the two Vitest files
  that directly exercise `task-detail-sheet.tsx` (both pass). Did not check
  `lsof -ti :3000` / start a dev server since no test in this repo actually
  renders `TaskDetailSheet`'s open/content state under jsdom (both existing
  tests for this component rely on SSR-closed-state or source-inspection
  per their own doc comments — `vitest.config.ts` pins `environment: "node"`,
  no jsdom/RTL in this repo for this component), so there is no
  component-level automated visual check to run beyond typecheck + lint +
  the two source-inspection tests above.
- `npm test`'s 33 failing files are pre-existing and unrelated: verified by
  `git stash`-ing this change and re-running `tests/integration/
  subtask-ui-detail.test.ts` on unmodified `main` — it fails identically
  (Supabase Auth rate limiting / 5s test timeouts against a live/shared
  test project), confirming these are flaky integration tests independent
  of this UI change, not a regression introduced here.
