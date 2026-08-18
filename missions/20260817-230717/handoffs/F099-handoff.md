# Handoff: F099 — invite listUsers pagination

## Status
COMPLETE

## Assertions covered
AS-007: PASS — verified by 3 new unit tests in `tests/unit/invite-member-pagination.test.ts` (mocked >50-user scenarios, match on page 3 of 130 users, match on the last page of 214 users, and no-match-proceeds-to-insert with 87 users) plus the pre-existing real-DB integration tests in `tests/integration/invite-member.test.ts`, all passing.

## Files changed
lib/actions/workspaces.ts
tests/unit/invite-member-pagination.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run test` (0) — 20 test files, 101 tests passed
`npm run lint` (0)
`npm run build` (0) — includes `next build`'s own TypeScript check, which is stricter than plain `tsc --noEmit` for test files (caught one type-inference issue in the new test's mock, fixed with a narrow `any` cast on `mockImplementation`)

## Decisions made
- Investigated whether `@supabase/supabase-js` / `@supabase/auth-js` support a direct email-filtered `listUsers` call before reaching for pagination, per the spec's explicit preference. Checked the installed package's shipped types directly (`node_modules/@supabase/auth-js/dist/module/GoTrueAdminApi.d.ts` and `lib/types.d.ts`): `listUsers(params?: PageParams)` where `PageParams = { page?: number; perPage?: number }` — no `filter`/`email`/`query` option exists. Confirmed no such feature is available as of this project's pinned version, so pagination is the correct fix, matching the spec's fallback instruction.
- Extracted the lookup into a new `findAuthUserByEmail(admin, email)` helper (in `lib/actions/workspaces.ts`, just above `inviteMember`) that loops `admin.auth.admin.listUsers({ page, perPage: 1000 })`, following the response's `nextPage` until it's `null` or a match is found. Chose `perPage: 1000` as a sane upper bound per API call to minimize round-trips, while still relying on `nextPage`/pagination (not a single-page assumption) for correctness — this way the fix is correct even if a given Supabase instance caps `perPage` lower than requested.
- Added a `maxPages = 1000` runaway-loop safety cap (1000 pages × 1000 users = 1,000,000 users) — purely defensive, not expected to be hit; the real termination condition is `nextPage === null`.
- Introduced a 3-state return (`User | null | "lookup_failed"`) from the helper so `inviteMember` can distinguish "no matching user" from "the lookup itself errored" and return the existing generic error message on failure, preserving prior error-handling behavior exactly.
- The new unit test mocks `admin.auth.admin.listUsers` to cap every page at 50 users regardless of the `perPage` the implementation requests — this deliberately exercises the actual pagination loop (via `nextPage`) rather than just asserting a large `perPage` value was passed, so the test would fail if a future regression went back to a single unpaginated call or stopped following `nextPage`.
- Did not touch `tests/integration/invite-member.test.ts` (the existing real-DB test suite) — it already covers the single-page case correctly and creating 50+ real throwaway Supabase auth users per test run would be slow and environmentally heavy; the new unit test fills the specific pagination gap the spec asked for without that cost.

## Out-of-scope work needed
None identified specific to this feature. General note: `findAuthUserByEmail` is a private helper local to `workspaces.ts`; if a future feature needs "look up an auth user by email" elsewhere, consider extracting it to a shared `lib/auth/` module rather than duplicating the pagination logic.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `perPage: 1000` (rather than leaving it at the API default or an arbitrary smaller number) to keep round-trips low for the common case, while still implementing full pagination via `nextPage` so correctness never depends on that specific number — the spec didn't mandate a page size, only that the lookup must not silently miss users past page 1.

## Notes for the next worker
- Verified no direct email-filter exists on Supabase's Admin `listUsers` by reading the shipped TypeScript declaration files directly (`node_modules/@supabase/auth-js/dist/module/GoTrueAdminApi.d.ts`, `lib/types.d.ts`) rather than relying on memory/docs — this is the authoritative source for the exact pinned version in this repo.
- `next build`'s TypeScript pass is stricter than a standalone `npx tsc --noEmit` for inferring types across mock object literals in test files; if a future worker's test file mock hits a similar overload-inference error only during `npm run build` (not `tsc --noEmit`), the same narrow `any`-cast-on-mockImplementation pattern used here is a reasonable escape hatch — just keep the cast as narrow as possible.

**Milestone 2 status**: This closes AS-007, the last open item from `M2-scrutiny.md`'s major-severity follow-up list. All 6 M2 follow-ups (F094–F099) are now implemented, tested, and committed. Milestone 2 should be fully complete and ready for a fresh scrutiny-validator re-run from a clean slate (no known open findings going into that re-run).
