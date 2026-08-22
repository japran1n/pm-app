# Handoff: F176 — next-occurrence maths + field copy rules

## Status
COMPLETE

## Assertions covered
AS-316: PASS — `tests/unit/recurrence.test.ts`'s `cloneTaskFields (AS-316)` suite unit-tests each copied field explicitly (title, description, description_json, assignees, priority, checklist items, estimate) and each excluded field explicitly by asserting the properties are absent on the cloned result (`comments`, `attachments`, `loggedTimeEntries`, `key`, `number`) plus a dedicated test proving `status` always resets to `"todo"` regardless of what the source task's status was.

## Files changed
lib/recurrence/next-date.ts
lib/recurrence/clone-fields.ts
tests/unit/recurrence.test.ts
missions/20260818-213033/handoffs/F176-handoff.md

## Commands run
`npx vitest run tests/unit/recurrence.test.ts` (0) — 43/43 passed
`npx tsc --noEmit` (0)
`npx eslint lib/recurrence tests/unit/recurrence.test.ts` (0)
`npx eslint .` (0 errors — 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts, not touched by this feature)
`npm run test` (24 failed / 1063 passed / 184 skipped across 186 files — all failures pre-existing, unrelated to this feature; see Notes)

## Decisions made
- **Month-end behaviour: CLAMP** to the shorter month's last day (Jan 31 + 1 month -> Feb 28/29, never overflows into March) — per the clarified spec's instruction to "pick clamp and document it." Implemented by delegating straight to date-fns's `addMonths`, which already clamps this way natively, so no hand-rolled month-end logic was needed. Verified with three explicit tests: non-leap Feb 28, leap-year Feb 29, and May 31 -> Jun 30.
- **DST correctness**: date arithmetic is anchored at UTC-noon on the relevant calendar day (not UTC-midnight, not the caller's local time), so date-fns's day/week/month arithmetic can never itself roll onto the adjacent day due to an offset shift. This mirrors the exact anchoring technique `lib/time/user-timezone.ts`'s `endOfDayInTimeZone` already documents for the same reason, rather than inventing a new convention. Explicit tests cross both the 2026-03-08 America/New_York spring-forward boundary and the 2026-11-01 fall-back boundary for `daily` and `weekly` rules.
- **`until` boundary is inclusive**: a computed next date that equals `until` is still a valid occurrence; only a date strictly *after* `until` returns null (AS-323). This matches F175's handoff description of `until` as "ends on that date" (the date itself is a valid occurrence day), not "ends before that date."
- **Reused `lib/time/user-timezone.ts`** (`isValidTimeZone`, `todayInTimeZone`) instead of writing new timezone-validation/now logic, per CLAUDE.md instructions to reuse this mission's existing F124 timezone infrastructure rather than inventing a second one. `next-date.ts` imports these two functions only — no new date library, per tech-decisions.md.
- **`nextOccurrenceDateFromToday`** is an added convenience wrapper (not asked for explicitly by the spec, but a natural, in-scope extension of the same module — a scheduled generation job needs "next occurrence from today," and duplicating the `todayInTimeZone` call at every future call site would be a second source of truth for "what counts as today"). Kept inside `lib/recurrence/next-date.ts`, no new file.
- **`clone-fields.ts` shape** — the exact allow-list, frozen here for F177/F178/F180 to reuse verbatim:
  - `CloneableTaskSource` input: `{ title, description, description_json, assigneeIds: string[], priority, checklistItems: {content, position}[], estimate_minutes }`.
  - `cloneTaskFields(source)` returns `ClonedTaskFields`: the same shape plus `status: "todo"` (always, via the exported `RECURRENCE_INITIAL_STATUS` constant — never read from the source).
  - `CLONEABLE_TASK_FIELDS` and `NON_CLONEABLE_TASK_FIELDS` are exported as real arrays (not just prose) so a caller/reviewer/test can assert against the list directly.
  - Checklist items are copied as `{content, position}` only — no `is_checked`/`checked_at`/`checked_by` — new occurrences always start with fresh, unchecked checklist items. This wasn't explicitly named as a definition-of-done item in AS-316's text but follows directly from the same "a new occurrence starts fresh" principle the status-reset rule states, and from `ChecklistItemSource`'s narrow type (it structurally cannot carry a checked flag through).
  - Assignees are copied by `user_id` only (`assigneeIds: string[]`), matching the actual DB shape (`task_assignees(task_id, user_id, assigned_by, created_at)` — a join table, not a column on `tasks`) confirmed by reading `lib/supabase/database.types.ts`. `assigned_by`/`created_at` on the assignment itself are NOT copied — a caller inserting the new occurrence's `task_assignees` rows sets its own `assigned_by`/`created_at` for the new assignment event.
  - This module deliberately reads only these seven input fields — it cannot accidentally "copy" a field it was never given (e.g. comments, attachments, time entries aren't even accepted as input), which is itself part of what makes the exclusion list enforceable rather than just documented.

## Out-of-scope work needed
- **Wiring `nextOccurrenceDate`/`cloneTaskFields` into an actual Server Action** that creates the new occurrence task + checklist items + assignee rows in Supabase belongs to F177/F178 (generation) per F175's handoff and this feature's own spec — this feature is deliberately pure-logic-only, no I/O.
- **Zod schema for validating a `recurrence` rule at the action layer** (mentioned in F175's handoff as still-needed) remains out of scope here too — no Server Action exists yet to attach it to.
- **UI for setting/editing a task's recurrence** — out of scope, unchanged from F175's note.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to make `until` an inclusive boundary (a next date equal to `until` is still valid) rather than exclusive, since the spec text only said "if the computed next date would be past it, return null" — "past" was read as strictly after, matching ordinary English usage and F175's own "ends on that date" phrasing. Recorded here so F177/F178 rely on the same inclusive semantics rather than re-deriving it.
AUTONOMOUS_DECISION: Checklist items are copied without their `is_checked` state (always fresh/unchecked) since AS-316 says checklist items are copied but doesn't state whether checked state carries over; treated as following from the same "new occurrence starts fresh" principle applied to status, and encoded structurally (the type has no checked field) so this can't drift later.

## Notes for the next worker
- `npm run test`'s full-suite run showed 24 failing tests, all pre-existing and unrelated to this feature: `Hook timed out`/`Test timed out` errors in `invite-member.test.ts`, `workspace-role-expansion.test.ts`, an `AuthApiError: Request rate limit reached` in `workspace-time-by-person.test.ts`, and two perf-budget assertions in `perf-budget.test.ts` exceeding their 500ms budget under full-suite parallel load. This is the exact same "flaky under full-suite load, hitting the live Supabase project's connection/rate limits" pattern F175's handoff documented one feature ago (and F299's before that) — none of these files touch `lib/recurrence/*`. `tests/unit/recurrence.test.ts` passed 43/43 both standalone and inside the full-suite run.
- Both new modules are pure/synchronous with zero I/O and zero Supabase/React imports, matching the clarified spec's dependency-boundary answer exactly — grep confirms no `@supabase` or `react` import anywhere in `lib/recurrence/`.
- `lib/recurrence/next-date.ts`'s and `lib/recurrence/clone-fields.ts`'s own top-of-file comments carry the full design rationale (month-end clamp choice, DST anchoring technique, `until` inclusivity, exact allow-list) — read them directly for anything not covered above.
