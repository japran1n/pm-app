# F003 — Split My Tasks realtime onto two channels [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F003 — Split My Tasks realtime onto two channels

**Milestone:** M1 · **Est:** 40 min · **Depends on:** none
**Assertions:** AS-007, AS-008, AS-009, AS-010, AS-011

**Scope:**
- `components/my-tasks/use-my-tasks-realtime.ts`: replace the single
  `acquireSharedTopicChannel` call carrying two `postgres_changes` bindings with
  two calls, topics `tasks:my-tasks:<userId>:assignees` and
  `tasks:my-tasks:<userId>:tasks`.
- The `trackedTaskIds` `Set` is passed to both handlers by reference so the
  cross-channel invariant holds (AS-011).
- `subscribeToMyTasksRealtime` returns one unsubscribe that releases both
  (AS-010).
- Public signature of `subscribeToMyTasksRealtime` and `useMyTasksRealtime`
  is unchanged — existing callers and tests must keep compiling.
- Tests: a dead assignees channel still delivers `tasks` updates (AS-008); a
  dead tasks channel still delivers assignment events (AS-009); unsubscribe
  releases both.

**Files:** `components/my-tasks/use-my-tasks-realtime.ts`, its test file.

## Definition of done

1. Every assertion named above is covered by at least one test that
   fails if the behaviour is removed.
2. `npx tsc --noEmit` exits 0 (AS-031).
3. `npm run lint` introduces no new errors (AS-032).
4. The unit/component suite passes; no new test requires a live
   Supabase connection (AS-033, AS-034).
5. No new dependency was installed.
6. Public signatures of anything this feature touches still compile for
   existing callers.
7. A handoff file exists at `missions/20260902-212300/handoffs/F003-handoff.md`
   and the work is committed.
