# F006c: Make the phase actually persist, and finish the page-type seam

**Milestone:** M1 remediation
**Estimated worker time:** 2.5 h
**Depends on:** F002, F005b
**Opened by:** the M1 scrutiny review, orchestrator-verified

## The defects

1. **AS-013 does not hold.** `lib/actions/tasks.ts` contains **zero**
   occurrences of `phase_id` or `phaseId` (verified by grep).
   `getTaskDetail` is the only producer of `TaskDetailSheetTask`, so
   `task.phaseId` in the sheet is always `undefined`: pick a phase,
   close the task, reopen it — "No phase". The write path works; the
   read path was never wired.

   **The test that should have caught this mocked `getTaskDetail` to
   return `phaseId: "phase-2"` — a field the real function never
   returns.** A test that mocks the producer of the thing it is testing
   proves only that the mock works. Do not repeat that shape here: this
   feature's test must go through the real `getTaskDetail`.

2. **F005b fixed half the seam.** `task-detail-sheet.tsx:1959` still
   gates the page-slug and page-order fields on
   `taskTypeName?.trim().toLowerCase() === "page"`. That sheet is the
   only UI that writes page order. So in the exact workspace F005b
   exists to serve — type tagged `system_key='page'`, named "Sida" —
   the portal lists the pages and the team cannot order them.

3. **`system_key` is unsettable.** The backfill is `name ilike 'page'`
   with no wildcard, and no write path exists anywhere in the app. An
   existing workspace whose type is named "Pages" or "Sida" gets a
   permanently empty Pages view telling the client "No pages have been
   shared with you yet" — a false statement, fixable only by hand-run
   SQL.

4. **AS-009 was never assigned to a feature.**
   `create_project_from_template` has no phase handling at all, so a
   project created from a template arrives with no phases.

## Assertion IDs covered
- AS-009: A project created from a project template receives that template's phases in the same transaction as the project itself.
- AS-013: A team member can assign a task to a phase from the task detail sheet, and the assignment survives a reload.
- AS-014: The portal Pages view lists every client-visible task of type `page`, ordered by the team's page order.

## Scope

1. Thread `phase_id` through `getTaskDetail` and `editTask` in
   `lib/actions/tasks.ts`, with the same validation the other task
   fields get. Test through the real function.
2. Gate the page fields on the task type's `system_key`, not its name.
   Thread the key into `TaskDetailSheetTask` alongside the name.
3. Give `system_key` a write path: in the task-types settings screen, a
   control to mark a type as the portal's page type, with the uniqueness
   the partial index already enforces surfaced as a clear message rather
   than a raw constraint error. Widen the backfill to catch the obvious
   existing names, and say in the handoff which ones you matched.
4. Extend the `kind='project'` template payload and
   `create_project_from_template` with phases, in the same transaction
   (AS-009). Old templates without a phases section must still work.

## Definition of done

- **Primary success test:** integration through the real
  `getTaskDetail` — assign a phase, re-read the task, the phase is
  there.
- **Failure test:** a workspace whose page type is named "Sida" but
  carries `system_key='page'` shows the page fields in the sheet and
  orders correctly in the portal.
- **Manual verification:** creating a project from a template with
  phases yields those phases; from one without, it still succeeds.
- **Side-effect verification:** no test in this feature mocks the
  function it is asserting about.
