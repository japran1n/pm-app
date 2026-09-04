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
          // inflicted cost no production code path pays. Adding the same
          // filter the passing sibling test and production already use
          // fixes the mechanism directly; the budget is restored to a
          // sane value now that the test matches real usage.
          // Same budget as this file's filtered sibling test below, which
          // uses the identical filtered-subscription shape and passes
          // reliably in CI at 13000ms.
          const timeout = setTimeout(() => resolve(null), 13000);

          subscriberClient
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
                // Only toggle once the subscriber is confirmed live, so
                // this test can't pass by accident on a race where the
                // event beats the subscription.
                void toggleReaction(commentId, "👍");
              }
            });
        });

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
      18000,
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
            // F320: same widened budget as the first test above, for the
            // same reason (this negative case's positive half — the
            // scoped channel DOES receive its own task's event — is
            // subject to the identical under-load delivery-latency
            // budget issue).
            const timeout = setTimeout(() => resolve(false), 13000);

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
      20000,
    );
  },
);
