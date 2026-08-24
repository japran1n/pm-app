# Handoff: F329 — Realtime channel re-subscribe crash on every workspace page

## Status
PARTIAL

(Code fix is complete, all automated tests pass, tsc/eslint clean, and I
verified the root cause directly against the installed @supabase/realtime-js
source. Marked PARTIAL rather than COMPLETE only because the spec requires
real-browser verification and I have no browser/preview tool available in
this session — see Blockers.)

## Assertions covered
This feature is a bugfix mission, not one with pre-assigned AS-NNN IDs in
validation-contract.md — I did not find F329 assertions in the contract to
list. If the orchestrator expects specific IDs here, none were found under
`missions/20260818-213033/validation-contract.md` for F329; treat the tests
below as the assertion set for this bugfix.

## Files changed
lib/realtime/shared-topic-channel.ts (new)
lib/notifications/subscribe-notifications-realtime.ts
lib/tasks/subscribe-comments-realtime.ts
lib/board/subscribe-board-realtime.ts
lib/board/subscribe-board-columns-realtime.ts
tests/unit/helpers/faithful-realtime-client.ts (new)
tests/unit/realtime-strict-mode-remount.test.ts (new)
tests/unit/notifications-realtime-subscription.test.ts
tests/unit/board-realtime-subscription.test.ts
tests/unit/board-columns-realtime.test.ts
tests/unit/comment-realtime-subscription.test.ts
tests/unit/reactions-realtime-subscription.test.ts

## Commands run
`npx tsc --noEmit` (0) — LITERAL output: empty (no errors)
`npx eslint .` (0) — LITERAL output:
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```
(Both warnings are pre-existing, unrelated to this feature — untouched files.)
`npx vitest run tests/unit` (0) — 130 files / 1003 tests passed (995 pre-existing + 8 new). One benign `Unhandled Rejection` logged from `tests/unit/user-avatar.test.tsx` (a `cookies()` outside request scope error inside `components/task/comment-list.tsx`'s `getMentionCandidates` effect) — pre-existing, unrelated to any file this feature touched, did not fail any test.
`npx vitest run tests/integration/comment-format-realtime.test.ts tests/integration/comment-delete-broadcast.test.ts tests/integration/reaction-realtime-delivery.test.ts` (0) — 3 files / 5 tests passed.
`npx vitest run tests/unit/realtime-strict-mode-remount.test.ts` (0) — 8/8 passed with the fix in place.
`git stash push -- lib/notifications/subscribe-notifications-realtime.ts lib/tasks/subscribe-comments-realtime.ts lib/board/subscribe-board-realtime.ts lib/board/subscribe-board-columns-realtime.ts` then re-ran the same new test file — 7/8 failed with the OLD code (including the exact production error message `cannot add \`postgres_changes\` callbacks for realtime:notifications:user-123 after \`subscribe()\`.`), proving the new tests actually pin the fix rather than mirroring the implementation. Then `git stash pop` restored the fix (the new `lib/realtime/` file was untracked so it was never stashed/lost).
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/w/goodguys/projects` (200 curl exit code, HTTP 307 — expected, unauthenticated curl redirected to login; not proof the page renders for a signed-in user).

## Decisions made
- Root cause was verified, not assumed, by reading the installed
  `@supabase/realtime-js@2.112.3` source directly:
  `node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js`
  `channel(topic)` dedupes by topic string — if a channel for that topic is
  still registered, it returns the SAME object instead of creating a new
  one. `RealtimeChannel.js` `on()` throws if the channel is already
  joined/joining. `RealtimeClient.removeChannel()` is `async` (awaits
  `channel.unsubscribe()` before deregistering) — every one of the four
  `subscribe*Realtime` modules called it as `void supabase.removeChannel(channel)`,
  never awaited, from the effect cleanup. React StrictMode's dev-only
  mount -> cleanup -> mount sequence runs synchronously in one tick, so the
  second mount's `channel(topic)` observed the first mount's still-joined
  channel (removeChannel's promise hadn't resolved yet) and crashed on
  `.on()`. Also confirmed `lib/supabase/client.ts`'s `createClient()` is a
  browser-wide singleton (`node_modules/@supabase/ssr`'s
  `createBrowserClient`, `cachedBrowserClient`), so this collision is real
  across component remounts, not just re-renders of one instance.
- Chose a shared, ref-counted, per-(client, topic) channel registry
  (`lib/realtime/shared-topic-channel.ts`) over the two alternatives the
  spec explicitly floated:
  - Rejected "make the topic unique per subscription instance": the spec's
    own warning proved out in my regression test — `lib/actions/comments.ts`
    broadcasts on the FIXED topic `comments:<taskId>`, so a listener on a
    per-instance-unique topic would silently stop receiving delete/restore/
    edit broadcasts. Verified this would break with a dedicated test
    (`test_F329_comments_broadcast_listen_pairing_still_works_after_a_remount`)
    before deciding against the unique-topic approach.
  - Rejected "make cleanup fully synchronous/awaited": React effect cleanup
    functions can't block the next effect's synchronous execution in
    StrictMode's double-invoke — even an `async` cleanup wouldn't be
    awaited before the second mount runs, so this wouldn't actually close
    the race.
  - Chose "reuse an existing subscribed channel instead of re-registering
    callbacks", implemented as a shared registry keyed by
    `WeakMap<SupabaseClient, Map<topic, Entry>>`: `.on()`/`.subscribe()`
    run at most once per topic for as long as any subscriber is attached;
    later `acquire` calls just add a callback to the topic's listener
    `Set` and reuse the live channel. Release defers actual
    `removeChannel` by one macrotask (`setTimeout(0)`), so a synchronous
    StrictMode remount that re-subscribes to the same topic in the same
    tick cancels the pending teardown and reuses the channel; a genuine
    unmount (no synchronous remount) lets the timer fire and tears the
    channel down as before.
  AUTONOMOUS_DECISION: keyed the registry by client instance (WeakMap), not
  a single global Map, so distinct Supabase client instances (a fresh mock
  per unit test, or theoretically multiple real clients) never share state
  — this also correctly models production, where `createClient()` is a
  singleton, so the WeakMap has exactly one live entry in the browser.
- AUTONOMOUS_DECISION: used a fan-out `Set<callback>` rather than
  "last acquire wins," so if this topic is ever legitimately subscribed by
  more than one live component instance at once (not just a StrictMode
  remount), every one of them keeps receiving events rather than only the
  most recent.
- Rewrote the four existing "removes the channel" unit tests
  (`notifications-realtime-subscription.test.ts`,
  `board-realtime-subscription.test.ts`, `board-columns-realtime.test.ts`,
  `comment-realtime-subscription.test.ts`) to `await` one macrotask before
  asserting `removeChannel` was called, since teardown is now intentionally
  deferred. This is a behavioral consequence of the fix, not a weakening —
  the assertion itself (teardown eventually happens) is unchanged and I
  added a dedicated test
  (`test_F329_a_real_unmount_eventually_tears_the_channel_down`) proving it.
- New test double (`tests/unit/helpers/faithful-realtime-client.ts`) models
  `channel()` topic-dedup, `.on()` throwing when joined/joining, and async
  `unsubscribe()`/`removeChannel()` — closely enough to reproduce the exact
  production error message, and I proved this by reverting the fix
  (`git stash`) and re-running the new test file: 7/8 failed with that
  exact message before the fix, 8/8 pass after.

## Out-of-scope work needed
- The pre-existing unhandled rejection in `components/task/comment-list.tsx`'s
  `getMentionCandidates` (`cookies()` outside request scope) surfaced as
  noise during `tests/unit/user-avatar.test.tsx` — did not fail any test,
  not part of this feature's scope (a Client Component effect calling a
  function that internally uses `createClient()`/`cookies()` in a test
  environment without a request scope), but worth its own follow-up if it
  ever starts failing tests.
- No MCP-registered service state was touched by this fix (no schema,
  policy, or Supabase-project-config change) — nothing to verify via MCP.

## Blockers
BLOCKER: cannot perform the spec-required real-browser verification (loading `http://localhost:3000/w/goodguys/projects`, confirming the error overlay is gone, checking the console) — no browser/preview tool was available in this worker's toolset (only Read, Write, Edit, Bash). I did not fabricate a claim of browser verification.
TRIED: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/w/goodguys/projects` against the already-running dev server, which returned HTTP 307 (redirect to login for an unauthenticated request) — this confirms the dev server is up and the route resolves, but is not equivalent to loading the page in a real, authenticated browser and confirming no runtime-error overlay, which is what the spec requires as evidence.
NEEDED: A worker or orchestrator turn with a browser/preview tool (or Playwright) available, authenticated as `sasa@goodguys.se` (or any workspace member of `goodguys`), to load `/w/goodguys/projects` and confirm (a) no Next.js Runtime Error overlay, (b) no console errors, (c) the board/projects UI actually renders.
SUGGESTED FOLLOWUP: Spec a small verification-only follow-up feature: "Using a browser/preview tool against the already-running dev server on port 3000, sign in (or reuse an existing authenticated session/storage state) as a `goodguys` workspace member, navigate to `/w/goodguys/projects`, and confirm the Realtime StrictMode-remount crash fixed in F329 (lib/realtime/shared-topic-channel.ts) is gone in a real browser: no Next.js Runtime Error overlay, no console errors referencing `postgres_changes` or `after \`subscribe()\``, and the projects board renders." This requires no further code changes if F329's fix holds — it is pure verification.

## Autonomous decisions
See "Decisions made" above — all AUTONOMOUS_DECISION items are inlined there (WeakMap-per-client-instance keying; fan-out Set instead of last-writer-wins; rejected unique-per-instance topics and synchronous-await cleanup as the two spec-suggested alternatives, in favor of shared-channel reuse, with rationale and a regression test proving the rejected approach would have broken comments broadcast delivery).

## Notes for the next worker
- The actual crash mechanism, confirmed by reading
  `node_modules/@supabase/realtime-js@2.112.3`'s `RealtimeClient.js`
  (`channel()`, `removeChannel()`) and `RealtimeChannel.js` (`on()`), and
  `node_modules/@supabase/ssr`'s `createBrowserClient.js`
  (`cachedBrowserClient` singleton) — see the doc comment at the top of
  `lib/realtime/shared-topic-channel.ts` for the full write-up with exact
  file/line references, kept there so it survives context resets.
- If a fifth `subscribe*Realtime` module is ever added, it MUST go through
  `acquireSharedTopicChannel` from `lib/realtime/shared-topic-channel.ts`
  rather than calling `supabase.channel(...).on(...).subscribe()` directly
  — that direct pattern is exactly what caused this bug, and the four
  fixed modules should not regress if someone copy-pastes the OLD pattern
  from git history instead of the current file contents.
- No MCP tools were needed for this fix — it's pure client-side Realtime
  subscription-lifecycle code, no schema/policy/live-config change.
