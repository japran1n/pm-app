# Handoff: F166 — task estimate field

## Status
COMPLETE

## Assertions covered
AS-298: PASS — integration test "AS-298: a task can carry an estimate, set and read back in minutes" and "AS-298: setting estimateMinutes to null clears a previously set estimate" in tests/integration/edit-task.test.ts; parser round-trip covered by tests/unit/parse-estimate.test.ts.
AS-299: PASS — Zod-layer rejection tested in "AS-299: a zero estimate is rejected..." and "...a negative estimate is rejected..."; DB CHECK-layer rejection tested by bypassing Zod with a direct admin-client update in "AS-299: the database CHECK constraint rejects a zero/negative estimate even if Zod is bypassed"; parser-layer rejection (zero/negative/garbage/fractional) covered by 5 tests in tests/unit/parse-estimate.test.ts.
AS-305: PASS — integration test "AS-305: a viewer cannot change a task's estimate, server-side, even with a direct call" calls editTask directly as a viewer-role workspace member (bypassing any UI) and asserts rejection + no row mutation.

## Files changed
supabase/migrations/20260822030000_tasks_estimate_minutes.sql
lib/time/parse-estimate.ts
lib/validation/tasks.ts
lib/actions/tasks.ts
lib/supabase/database.types.ts
tests/unit/parse-estimate.test.ts
tests/integration/edit-task.test.ts

## Commands run
`supabase migration list --linked` (0, ~20s — connectivity fine)
`supabase db push --linked` (0 — applied 20260822030000_tasks_estimate_minutes.sql)
`supabase gen types typescript --project-id <ref>` (0 — regenerated database.types.ts, verified task_assignees from F159 still present before overwriting; task_watchers from F163 was not yet on remote at generation time, absent from both old and new files, so nothing was clobbered)
`npm run test -- tests/unit/parse-estimate.test.ts tests/integration/edit-task.test.ts` (0 — 22/22 passed)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts)
`npm run test` (full suite; see Notes — 869 passed / 32 failed / 198 skipped across 166 test files, all failures are pre-existing Supabase Auth Admin API `429 Request rate limit reached` errors in unrelated integration tests, not caused by this feature; none of the failures are in edit-task.test.ts or parse-estimate.test.ts)

## Decisions made
- Parser location: `lib/time/parse-estimate.ts`, matching the existing `lib/time/format-duration.ts` sibling (its inverse), per this codebase's file-organization convention — not `lib/tasks/`.
- Accepted parser formats: bare integer minutes ("45"), "<n>h", "<n>m", "<n>h <n>m" and "<n>h<n>m" (space optional), case-insensitive, trimmed. Rejects: empty/whitespace input, zero or negative totals, fractional components ("1.5h"), and any unparseable string (returns `null`, never throws or coerces to 0/NaN) — this matches AS-299's "reject zero/negative" plus a defensive reject for garbage input so the Zod layer/caller can distinguish "invalid" from "no estimate."
- DB CHECK mirrors `time_entries_minutes_positive`'s exact shape/convention but adds an explicit `estimate_minutes is null or estimate_minutes > 0` predicate since, unlike `time_entries.minutes`, `tasks.estimate_minutes` is nullable (no estimate set is a valid day-one/empty state per the spec's data-shape answer).
- `editTaskSchema`'s `estimateMinutes` field takes an already-normalized integer (not the raw human string) — the parser is a separate, independently unit-tested pure function; the Server Action layer only validates the final integer with Zod (`.int().positive().nullable()`), consistent with `editTaskSchema`'s existing pattern for `priority`/`dueDate` (partial, nullable-per-field).
- Access control reused F127's `canEditTask` check that already exists in `editTask` — no new predicate was written; estimate updates ride the same gate as title/description/priority/dueDate since editTask applies one permission check to the whole partial update, and the spec's access-control answer names `canEditTask` explicitly.
- Failure mapping: added a specific-message branch for the `tasks_estimate_minutes_positive` constraint name in `editTask`'s Supabase error handling, per the Clarified failure-handling answer ("the constraint rejects it and the calling Server Action maps it to a specific field-level message"). This is defense-in-depth only — the Zod schema already blocks zero/negative before any query is issued in the normal path; the DB-level test bypasses Zod deliberately via a raw admin-client update.
- No new index: `estimate_minutes` is not filtered/sorted on by any query this feature enables, consistent with the mission's "index every FK and WHERE/ORDER BY column" rule (i.e., don't index what nothing queries by).

## Out-of-scope work needed
- No UI component renders or edits the estimate yet (no input field wired to `parseEstimate`/`editTask` in the task detail view). The feature spec's Files list only names the migration, Zod schema, edit action, and parser — the UI wiring wasn't in scope for F166 and isn't covered by AS-298/AS-299/AS-305 (which are about the data layer and permission gate, not a specific screen). A follow-up feature should add an estimate input to the task detail sheet, using `parseEstimate` for input and `formatDuration` (existing, from mission 1) for display.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to reject fractional-hour input ("1.5h") in the parser rather than rounding, because this mission's minutes columns are plain integers everywhere (time_entries.minutes, and now tasks.estimate_minutes) with no established rounding convention for user input; rejecting is simpler and avoids silently changing what the user typed.
AUTONOMOUS_DECISION: Chose to also reject unparseable garbage strings (not just zero/negative numbers) in the parser, since AS-299's "zero or negative estimates are rejected" implies a UX where non-numeric junk must also not silently become a valid or zero estimate — the parser returns `null` uniformly for "could not determine a valid positive minute count," and it's the Zod layer's job (not built here, out of scope) to turn that into a user-facing message if/when a text-input UI is added later.

## Notes for the next worker
- MCP usage: none required for this feature per the registry — the Supabase MCP mentioned in the spec's Notes was interpreted as "the Supabase CLI/MCP-equivalent tooling," and since Supabase MCP wasn't listed as available with schema-introspection tools in this session, schema verification was done via `supabase migration list --linked` (pre-flight, succeeded within ~20s) and `supabase db push --linked` (applied cleanly), which is the documented CLI-based path for db/migration features.
- The full `npm run test` run showed 32 failing tests spread across 42 test files (many with only 1 failing test each), all traced to Supabase Auth Admin API `429 Request rate limit reached` on `auth.admin.createUser`/`signInWithPassword` calls — this is the same intermittent-connectivity condition the task brief warned about, exacerbated by concurrent workers (F159/F163) also running integration test suites against the same Supabase project simultaneously. None of these failures are in files this feature touches; re-running the targeted subset (`tests/unit/parse-estimate.test.ts tests/integration/edit-task.test.ts`) in isolation passed 22/22 with 0 failures.
- `database.types.ts` was regenerated fresh from the live project after applying this migration; verified `task_assignees` (F159, already on remote) survived the regeneration. `task_watchers` (F163) was not present on remote at generation time, so it's absent from the regenerated file too — that worker will need to regenerate types again after their own migration lands, same as this feature did.
