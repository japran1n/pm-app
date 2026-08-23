# Handoff: F301 — Fix red description-mentions tests + stop silent mention corruption on DB error (M15 scrutiny follow-up, D4/D5)

## Status
COMPLETE

## Assertions covered
AS-374: PASS — `test_AS_374_AS_381_notifyNewlyMentionedUsers_delivers_a_mention_notification_per_newly_mentioned_id` in tests/unit/description-mentions.test.ts now passes (fake admin client extended with `.select().in()`).
AS-375: PASS — `test_AS_375_notifyNewlyMentionedUsers_promotes_each_mentioned_non_watcher_to_watcher` passes.
AS-381: PASS — covered by the same `test_AS_374_AS_381_...` test above.
AS-384: PASS — `test_AS_384_notifyNewlyMentionedUsers_never_notifies_the_author_of_their_own_mention` passes.

## Files changed
lib/comments/mentions.ts
lib/actions/comments.ts
lib/actions/tasks.ts
tests/unit/description-mentions.test.ts
tests/unit/comment-mentions.test.ts
missions/20260818-213033/handoffs/F301-handoff.md

## Commands run
`npx vitest run tests/unit/description-mentions.test.ts tests/unit/comment-mentions.test.ts tests/unit/mention-extension.test.tsx tests/unit/mention-picker-narrowing.test.tsx` (0, 39/39 passed)
`npx vitest run tests/unit` (exit non-zero: 3 files / 3 tests fail — user-avatar.test.tsx and comment-list-related tests fail on a pre-existing `cookies()`/Supabase-client-outside-request-scope environment issue, confirmed pre-existing via `git stash` baseline run which showed 4 failed files/6 failed tests before this change, 3 of which were exactly the description-mentions tests this feature fixes; the remaining 3 are unrelated to any file this feature touches)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts)
`npx vitest run tests/integration/mention-visibility.test.ts` (failed — `beforeAll` hook timed out; confirmed this is the known standing PostgREST outage logged in run-log.md at ~05:24Z, not caused by this change)

## Decisions made
- Fixed the fake Supabase client in tests/unit/description-mentions.test.ts by adding `.select(columns).in(column, values)` to the chainable builder returned from `.from()`, resolving `{ data: [], error: null }` by default — matching `filterRecipientsByInAppPreference`'s documented "no row for this user: fail open" behaviour, so no other assertion in that file needed to change.
- Reviewed `filterRecipientsByInAppPreference` (lib/notifications/preferences.ts) per the task's instruction to check it for "the same ignores-error mistake." It does NOT have that bug: it already destructures and checks `error` (`if (error || !data) { ...fail open... }`), and its doc comment explicitly documents fail-open-on-error as the intended, safe behaviour for notification delivery (worst case: over-notify, never silently drop a legitimate recipient or corrupt data). No code change was needed there — left unchanged.
- Added `MentionVisibilityCheckError` (exported from lib/comments/mentions.ts) and made `resolveVisibleMentionIds` throw it when either the `workspace_members` or `project_members` query returns a Supabase `error`, instead of proceeding with `data ?? []`/treating null as empty. `sanitiseMentionsForVisibility` was left as a pure pass-through — it doesn't catch the error, so it propagates to its callers unchanged (least-disruptive: no new return shape on that function).
- Read how `addComment`/`editComment` (lib/actions/comments.ts) and `editTask` (lib/actions/tasks.ts) call `sanitiseMentionsForVisibility` before deciding the fix: all three already return a `{ ok: boolean; error?: string }` shape with `ok: false` on every other failure path. Wrapped each call site in a `try/catch` that, on `MentionVisibilityCheckError` (or any other throw), logs the error server-side and returns `{ ok: false, error: "..." }` — this is the "lib stays pure/typed-error, the calling Server Action decides how to surface it" convention from this mission, applied with zero change to any function's existing external return contract (still the same `{ ok, error }` union every caller already handles).
- Chose "fail the whole write" over "leave mentions untouched and log" per the task's explicit instruction to prefer the more defensive option when ambiguous, and because "leave untouched" for `editTask` would mean silently keeping possibly-invisible mentions in the description on a DB hiccup — a smaller but still real information-disclosure regression versus AS-376's whole point. Failing the write (existing "please try again" UX, no partial/inconsistent state) is strictly safer and requires no new UI state.
- Added a new test suite in tests/unit/comment-mentions.test.ts (`describe("F301: a transient DB error resolving mention visibility never silently strips mentions")`) with 3 tests: `resolveVisibleMentionIds` throws `MentionVisibilityCheckError` on a `workspace_members` query error, throws on a `project_members` query error, and `sanitiseMentionsForVisibility` propagates the error (rejects) rather than returning a document with mentions rewritten to "Former member" — proving the assertion-level behaviour (not implementation) the task asked for.

## Out-of-scope work needed
None identified beyond what F301's spec covers. The pre-existing 3 failing tests in tests/unit (user-avatar.test.tsx and a comment-list-adjacent test) fail on an unrelated `cookies()`-outside-request-scope / missing Supabase env-var issue in the test environment setup, not on anything this feature touched — confirmed via `git stash` baseline (same 3 tests failed before this change too). Worth its own follow-up if the orchestrator wants that cleaned up, but out of scope here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "throw a typed error from the lib layer, caller fails the whole write with its existing ok:false shape" over "leave mentions untouched and log" as the D5 fix, per ZERO_QUESTIONS guidance to prefer the more defensive/least-disruptive option — see Decisions made above for full reasoning.
AUTONOMOUS_DECISION: Left `filterRecipientsByInAppPreference` (lib/notifications/preferences.ts) unchanged after confirming its error handling is already correct and its fail-open behaviour is intentional/documented, rather than "fixing" something that wasn't actually broken just because the task description flagged it as worth checking.

## Notes for the next worker
- `tests/integration/mention-visibility.test.ts` could not be run against a live Supabase project this session — PostgREST is still down per the standing outage logged in missions/20260818-213033/run-log.md (~05:24Z entry, `PGRST002`). Confirmed independently: running it now still times out in `beforeAll` after 10s trying to reach the project. Re-run this integration file once PostgREST recovers to get a real-DB proof that the D5 fix's error path is reachable end-to-end (the unit tests in tests/unit/comment-mentions.test.ts already cover the logic with a fake client).
- No MCP tools were used for this feature — it's pure application-code/test-code work, no schema or live-config changes.
