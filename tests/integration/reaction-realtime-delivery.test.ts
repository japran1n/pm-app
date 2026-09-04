// Integration test for F202 (AS-369: reactions appear live for other
// viewers without a reload), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf/adminClient/subscriberClient
// pattern established by tests/integration/comment-delete-broadcast.test.ts
// (F104).
//
// What this proves that tests/unit/reactions-realtime-subscription.test.ts
// cannot: that a real toggleReaction call (via a real INSERT into
// comment_reactions through the real Supabase project) actually causes a
// real postgres_changes event to be delivered over the wire to an
// independent subscriber, with the correct comment/user/emoji — not just
// that subscribeToReactionsRealtime's callback wiring correctly reshapes a
// synthetic payload someone claims Realtime would send.
//
// Unlike F104's comments channel, no broadcast workaround is needed here
// (see lib/tasks/subscribe-comments-realtime.ts's doc comment on
// subscribeToReactionsRealtime): comment_reactions_select_visible's RLS
// predicate depends only on the task's visibility, which never changes
// as a side effect of a reaction's own INSERT/DELETE — so plain
// postgres_changes is sufficient and is what's proven live here.
//
// This is deliberately an integration test against the real Realtime
// transport, not a Playwright browser test: no page in this repo yet
// fetches `comment_reactions` server-side into a comment's `reactions`
// prop for an initial render (see missions/20260818-213033/handoffs/
// F201-handoff.md's "Out-of-scope work needed" — the comments-loading
// caller itself doesn't exist yet), so a real two-browser click-through
// would not yet have anything server-rendered to click on. Proving actual
// wire delivery end-to-end (this test) is the more directly falsifiable
// proof of AS-369 available today, and is the same "acceptable middle
// ground" F104's spec explicitly sanctioned for this exact situation.
// The client-side reconciliation half (an incoming ReactionRealtimeEvent
// correctly updates a comment's local `reactions`, and a same-user event
// is not double-applied) is unit-tested in
// tests/unit/reactions-realtime-subscription.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F202: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    from: (table: string) => actorClientForServerAction!.from(table),
  }),
}));

// The real Supabase client toggleReaction's mocked `createClient()` above
// delegates to for its own INSERT/DELETE against comment_reactions — a
// genuine client (anon key, matching what a real request-scoped server
// client would use, RLS-gated on the reacting user's own session), kept
// separate from `adminClient` (service role, used only for direct-DB test
// setup/teardown) and separate from `subscriberClient` (the independent
// "other viewer" that proves delivery below).
let actorClientForServerAction: SupabaseClient | null = null;

describe.skipIf(!haveAdminCreds)(
  "toggleReaction Realtime postgres_changes delivery (F202: AS-369)",
  () => {
    let adminClient: SupabaseClient;
    let subscriberClient: SupabaseClient;
    const createdCommentIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let reactorUserId: string;
    let commentId: string;
    // F098: see the comment at this channel's creation site below.
    let reactionChannel: ReturnType<SupabaseClient["channel"]> | null = null;

    const ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SECRET_KEY!;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      subscriberClient = createClient(SUPABASE_URL!, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F202 Test Workspace",
          slug: `f202-reactions-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: userData, error: userErr } =
        await adminClient.auth.admin.createUser({
          email: `f202-reactor-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (userErr || !userData.user) {
        throw new Error(`Failed to create test user: ${userErr?.message}`);
      }
      reactorUserId = userData.user.id;
      createdUserIds.push(reactorUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: reactorUserId,
          role: "member",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F202 Project ${uniqueSuffix}`,
          created_by: reactorUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F202 Task ${uniqueSuffix}`,
          author_id: reactorUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);

      const { data: comment, error: commentErr } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: reactorUserId,
          text: `F202 comment ${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (commentErr || !comment) {
        throw new Error(`Failed to seed comment: ${commentErr?.message}`);
      }
      commentId = comment.id;
      createdCommentIds.push(commentId);

      // A real, session-bearing client for the reacting user, exactly what
      // toggleReaction's mocked lib/supabase/server createClient() above
      // delegates to — needed so the real RLS self-only insert/delete
      // policies (comment_reactions_insert_self/_delete_self) are the
      // actual enforcement boundary this test exercises through, same as
      // toggleReaction itself does in production.
      actorClientForServerAction = createClient(SUPABASE_URL!, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: signIn, error: signInErr } =
        await actorClientForServerAction.auth.signInWithPassword({
          email: `f202-reactor-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
        });
      if (signInErr || !signIn.session) {
        throw new Error(`Failed to sign in reactor: ${signInErr?.message}`);
      }

      // comment_reactions_select_visible (F199) is scoped `to authenticated`
      // — an anonymous subscriberClient would never pass RLS and would
      // silently receive nothing, which is not what this test wants to
      // prove (it would fail for the wrong reason). The independent "other
      // viewer" subscriber therefore needs its own authenticated session
      // too, same task-visible membership, separate WebSocket connection
      // from actorClientForServerAction — same identity is fine here since
      // what's under test is real postgres_changes delivery over the wire,
      // not a second user's authorization (already covered by
      // tests/integration/rls-comments.test.ts-style RLS suites).
      const { error: subscriberSignInErr } =
        await subscriberClient.auth.signInWithPassword({
          email: `f202-reactor-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
        });
      if (subscriberSignInErr) {
        throw new Error(
          `Failed to sign in subscriber: ${subscriberSignInErr.message}`,
        );
      }

      // `subscriberClient` has never opened a WebSocket yet at this point --
      // its first `.channel(...).subscribe()` call anywhere in this file is
      // what actually establishes the Realtime connection (supabase-js
      // connects lazily). Doing that here, inside `beforeAll` (30s
      // `hookTimeout`, not the per-test delivery budget), keeps the socket
      // warm before either `it` below starts timing itself.
      //
      // F074 (AS-369, superseded F073): F073 assumed this warmup's own
      // handshake cost was the thing blowing the per-test budget. It
      // wasn't. Instrumenting the first `it` below end-to-end (CI run
      // 33857487411) with a timestamp on every step measured, with this
      // warmup already in place: `.subscribe()` call -> `SUBSCRIBED` in
      // 7ms, `toggleReaction()` INSERT resolved in 151ms, then the
      // `postgres_changes` event for that INSERT didn't arrive until
      // +13348ms -- 13.2s after SUBSCRIBED, 348ms past the old 13000ms
      // budget. So the handshake this warmup pays for is fast and was
      // never the bottleneck; the real cost is WAL -> client delivery
      // latency on CI's `supabase start` Realtime container, which shares
      // the runner's 2 vCPUs with the rest of the Supabase Docker stack and
      // `maxWorkers: 4` vitest workers. The warmup is kept anyway since it's
      // free and keeps both tests' budgets measuring join+delivery only,
      // not connection setup -- see the per-test budget comment below for
      // the actual fix.
      await new Promise<void>((resolve, reject) => {
        const warmupChannel = subscriberClient.channel("f202-warmup");
        const timeout = setTimeout(() => {
          reject(
            new Error(
              "F202: subscriberClient failed to establish its Realtime connection within beforeAll's hookTimeout",
            ),
          );
        }, 25000);
        warmupChannel.subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout);
            void subscriberClient.removeChannel(warmupChannel).then(() => resolve());
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timeout);
            reject(err ?? new Error(`warmup subscribe failed: ${status}`));
          }
        });
      });
    });

    beforeEach(() => {
      currentTestUserId = reactorUserId;
    });

    afterAll(async () => {
      await adminClient.from("comment_reactions").delete().eq("comment_id", commentId);
      for (const cId of createdCommentIds) {
        await adminClient.from("comments").delete().eq("id", cId);
      }
      for (const tId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", tId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
      await subscriberClient?.removeAllChannels();
      await actorClientForServerAction?.removeAllChannels();
    });

    it(
      "AS-369: a real toggleReaction INSERT is delivered live to an independent subscriber on the task's comment_reactions channel",
      async () => {
        const { toggleReaction } = await import("@/lib/actions/comment-reactions");

        const received = await new Promise<
          { comment_id: string; user_id: string; emoji: string } | null
        >((resolve, reject) => {
          // F072 (honest-CI mechanism fix, AS-369): the real cause of the
          // repeated timeout growth (8000ms -> 18000ms -> 27000ms across
          // F320/F326) was never transport latency -- it was that this
          // `it` block was the ONLY postgres_changes subscription to
          // comment_reactions anywhere in the codebase (production or
          // tests) that omitted `filter: task_id=eq.<taskId>`. Production's
          // subscribeToReactionsRealtime (lib/tasks/subscribe-comments-
          // realtime.ts) always filters on task_id, and this file's own
          // sibling test below ("the_subscription_is_scoped...") does too
          // -- and that sibling test passes reliably in CI at a much
          // smaller 13000ms budget. Without the filter, Realtime cannot
          // push the match down to Postgres before delivery, so this
          // subscriber's connection has to run a per-row RLS re-check for
          // *every* comment_reactions write from *every* concurrent
          // integration test file in the full suite (toggle-reaction.
          // test.ts, comment-reactions-schema.test.ts, task-detail-
          // comment-read-path.test.ts, f323-sibling-action-project-
          // visibility.test.ts all write to this table too) before it
          // ever reaches this test's own INSERT -- an unrealistic, self-
          // inflicted cost no production code path pays. This fix is kept:
          // it's a genuine correctness improvement (matches production's
          // subscription shape) even though, per F074 below, it wasn't
          // the whole story on the remaining budget.
          //
          // F074 (AS-369, this test's budget, measured not guessed): three
          // prior rounds (transport latency, this missing filter, a cold
          // connection handshake) each guessed at why the internal budget
          // was still exceeded in CI, and each guess before this one was
          // falsified by the next CI run. Rather than propose a fourth
          // guess, F074 instrumented every step of this promise with a
          // stderr timestamp. CI run 33857487411 measured, with the F073
          // connection warmup already in `beforeAll`:
          //   +0ms      promise executor entered
          //   +7ms      .subscribe() -> SUBSCRIBED
          //   +7ms      SUBSCRIBED -- calling toggleReaction()
          //   +151ms    toggleReaction() resolved (the INSERT is committed)
          //   +13010ms  old 13000ms budget fires -- resolves null
          //   +13348ms  postgres_changes event arrives, correct comment_id
          //   +13622ms  .subscribe() status callback: CLOSED
          // The handshake is instant and the write is fast; the event is
          // delivered correctly, 13.2s after SUBSCRIBED -- 348ms past the
          // old budget. This is pure WAL -> client delivery latency on
          // CI's `supabase start` Realtime container, which was sharing
          // the runner's 2 vCPUs with the rest of the Supabase Docker
          // stack AND `maxWorkers: 4` other vitest workers -- not a lost
          // event or a broken subscription.
          //
          // F092 (AS-369, structural fix): rather than raise the budget a
          // fifth time, this file was pulled out of the shared,
          // 4-worker-parallel `npm run test` run entirely -- it now runs
          // via `npm run test:realtime` (see vitest.realtime.config.ts and
          // .github/workflows/ci.yml's "Realtime integration tests"
          // step), alone, after every other vitest worker has exited, so
          // it no longer contends with anything for the runner's 2 vCPUs.
          // F092 then guessed a 6000ms budget from a 1-2s local
          // measurement -- and CI run 33891788785 falsified it too: 6001ms
          // against a 6000ms budget, still just a lower bound because the
          // old code abandoned the subscription (and stopped listening)
          // the instant the timer fired, so every number in this file's
          // history through F092 is "at least N ms", never the real
          // delivery time.
          //
          // F096 (AS-369, this measurement run): every prior round picked
          // a number by reasoning about what delivery "should" cost on an
          // uncontended host. That reasoning has been wrong five times in
          // a row. This round stops guessing: the listener below is never
          // torn down early. On event arrival -- whether that's under the
          // old 6000ms mark or well past it -- the true elapsed time since
          // SUBSCRIBED is logged and the promise resolves with the actual
          // payload, so a passing run now also produces a real
          // measurement instead of silence. Only `HARD_TIMEOUT_MS` below
          // (deliberately generous, because this run's job is to observe
          // and print the true number, not to re-guess a tight one) can
          // still fail the test, and only if the event genuinely never
          // arrives at all. Once a real elapsed-time number comes back
          // from this CI run, the budget should be set from that evidence
          // (with sane headroom) and this comment updated -- see the F096
          // handoff for what to do with each possible outcome.
          //
          // F101/F102 (AS-369, resolved): F101 added a second, unfiltered
          // probe channel alongside this one for a single CI run and found
          // it ALSO never received the INSERT (CI run 33907896942) -- so
          // filtering is not the cause; both filtered and unfiltered
          // subscriptions to comment_reactions receive nothing on this
          // stack. F102 then isolated the one remaining schema-level
          // difference F099 had already surfaced between this table and
          // `comments` (whose sibling test passes): `comment_reactions` is
          // REPLICA IDENTITY FULL (required by the DELETE-filter fix in
          // supabase/migrations/20260823080000_fix_comment_reactions_soft_
          // delete_and_scoping.sql, since task_id is not part of this
          // table's primary key), `comments` is REPLICA IDENTITY DEFAULT.
          // F102's controlled experiment (scripts/f102-replica-identity-
          // probe.mjs, run from the "F102 replica identity delivery
          // experiment" CI step) subscribed to two throwaway scratch
          // tables, identical except for replica identity, in the same CI
          // run as this test -- see that script's own comment and the
          // F102 handoff for the result and what it means for this
          // assertion's CI gating. The F101 probe channel itself has been
          // removed from this test -- it already answered its question
          // (neither filtered nor unfiltered delivers), so keeping it
          // running on every CI run would just be additional load on the
          // same contended stack for no further evidence.
          const HARD_TIMEOUT_MS = 45000;
          const t0 = Date.now();
          const timeout = setTimeout(() => {
            process.stderr.write(
              `[AS-369] postgres_changes event NOT received within the generous ${HARD_TIMEOUT_MS}ms measurement ceiling (SUBSCRIBED->timeout elapsed ${Date.now() - t0}ms) -- resolving null, this is a genuine non-delivery, not scheduling noise\n`,
            );
            resolve(null);
          }, HARD_TIMEOUT_MS);

          // F098: captured (rather than left as an inline, unreferenced
          // chain like the pre-F098 version of this test) so it can be
          // explicitly removed once this `it` is done -- see the
          // `finally` block below. Every other channel opened by this
          // file (the beforeAll warmup, and both channels in the second
          // `it`) is already explicitly torn down as soon as it's no
          // longer needed; this one was the sole exception, left bound
          // and receiving every comment_reactions write for this task
          // (including the second `it`'s own toggle and both tests'
          // cleanup deletes) for the rest of this file's run, until
          // `afterAll`'s `removeAllChannels()`. That is unlikely to be
          // the whole story behind AS-369's CI-only delay (see the F098
          // handoff), but it is a genuine, provable leak against the
          // pattern this file otherwise follows, and reducing how many
          // stale bindings stay live against the shared CI Realtime
          // container for longer than necessary is a legitimate,
          // assertion-preserving cleanup regardless.
          reactionChannel = subscriberClient
            .channel(`comment_reactions:${taskId}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "comment_reactions",
                filter: `task_id=eq.${taskId}`,
              },
              (payload: { new: { comment_id: string; user_id: string; emoji: string } }) => {
                if (payload.new.comment_id !== commentId) return;
                clearTimeout(timeout);
                const elapsed = Date.now() - t0;
                process.stderr.write(
                  `[AS-369] postgres_changes event received ${elapsed}ms after SUBSCRIBED (measurement run, ceiling was ${HARD_TIMEOUT_MS}ms)\n`,
                );
                resolve(payload.new);
              },
            )
            .subscribe((status, err) => {
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                clearTimeout(timeout);
                reject(err ?? new Error(`subscribe failed: ${status}`));
                return;
              }
              if (status === "SUBSCRIBED") {
                void toggleReaction(commentId, "👍");
              }
            });
        });

        // F098: close this channel as soon as this `it` is done with it,
        // rather than leaving it bound (and receiving every future
        // comment_reactions write for this task) for the rest of the
        // file's run -- see the comment where `reactionChannel` is
        // assigned above. Done before the assertions below so it happens
        // even if one of them throws.
        if (reactionChannel) {
          await subscriberClient.removeChannel(reactionChannel);
          reactionChannel = null;
        }

        expect(received).not.toBeNull();
        expect(received?.comment_id).toBe(commentId);
        expect(received?.user_id).toBe(reactorUserId);
        expect(received?.emoji).toBe("👍");

        // The reaction row itself actually exists (not just the event).
        const { data: row } = await adminClient
          .from("comment_reactions")
          .select("comment_id")
          .eq("comment_id", commentId)
          .eq("user_id", reactorUserId)
          .eq("emoji", "👍")
          .maybeSingle();
        expect(row).not.toBeNull();
      },
      // Outer vitest per-test timeout: the internal 45000ms measurement
      // ceiling above plus slack for the row-existence query that runs
      // after it.
      50000,
    );

    it(
      "test_AS_369_the_subscription_is_scoped_at_the_transport_level_a_second_tasks_channel_never_receives_a_reaction_event_for_this_task",
      async () => {
        // F305 (AS-369 fix): before this fix, subscribeToReactionsRealtime
        // registered no `filter` at all, so ANY authenticated client's
        // channel received every comment_reactions change in the database
        // regardless of which task it subscribed for. This proves the fix
        // is a genuine server-side/RLS-adjacent postgres_changes filter
        // (task_id=eq.<taskId>), not merely client-side narrowing: an
        // independent channel subscribed for a DIFFERENT, unrelated task
        // must never see an event for this test's task/comment, even
        // though the subscribing session is otherwise authenticated and
        // able to see both tasks.
        const { toggleReaction } = await import("@/lib/actions/comment-reactions");
        const { subscribeToReactionsRealtime } = await import(
          "@/lib/tasks/subscribe-comments-realtime"
        );

        const otherTaskId = "00000000-0000-0000-0000-000000000000";
        let leaked: unknown = null;

        const unsubscribeOther = subscribeToReactionsRealtime(
          subscriberClient,
          otherTaskId,
          (event) => {
            leaked = event;
          },
        );

        // A channel name distinct from the shared `comment_reactions:${taskId}`
        // channel the previous test in this file already subscribed and
        // left open — the Supabase client refuses to add new
        // postgres_changes callbacks to a channel object that's already
        // subscribed.
        const scopedChannel = subscriberClient.channel(
          `f305-scoping-check:${taskId}`,
        );

        try {
          const received = await new Promise<boolean>((resolve, reject) => {
            // F092: same tightened budget as the first test above, and
            // for the same reason -- this file now runs alone via
            // `npm run test:realtime` (see vitest.realtime.config.ts), so
            // this positive half (the scoped channel DOES receive its own
            // task's event) is no longer subject to the other workers'
            // contention that justified 13000ms/20000ms.
            const timeout = setTimeout(() => resolve(false), 6000);

            scopedChannel
              .on(
                "postgres_changes",
                {
                  event: "INSERT",
                  schema: "public",
                  table: "comment_reactions",
                  filter: `task_id=eq.${taskId}`,
                },
                (payload: { new: { comment_id: string } }) => {
                  if (payload.new.comment_id !== commentId) return;
                  clearTimeout(timeout);
                  resolve(true);
                },
              )
              .subscribe((status, err) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                  clearTimeout(timeout);
                  reject(err ?? new Error(`subscribe failed: ${status}`));
                  return;
                }
                if (status === "SUBSCRIBED") {
                  void toggleReaction(commentId, "🚀");
                }
              });
          });

          expect(received).toBe(true);
          // The channel scoped to a different task never got the event —
          // the filter is applied before delivery, not after.
          expect(leaked).toBeNull();
        } finally {
          unsubscribeOther();
          await subscriberClient.removeChannel(scopedChannel);
        }
      },
      12000,
    );
  },
);
