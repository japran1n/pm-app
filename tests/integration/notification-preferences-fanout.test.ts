// F211: real-Supabase integration coverage proving notification
// preferences actually gate fan-out end-to-end (AS-391) — a user who
// disables a kind's in-app preference triggers the real event and no
// notification row is ever written for them, not merely that the
// recipient-set computation excludes them (see
// tests/unit/notification-preferences-filter.test.ts for the mocked
// pure-logic coverage). Pattern mirrors
// tests/integration/notification-fanout.test.ts (F207) exactly: mocks
// @/lib/supabase/server's createClient() to resolve to a REAL signed-in
// session client so the Server Action under test runs against the real
// database, RLS, and RPCs.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F211: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let sessionClientForMock: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClientForMock,
}));

describe.skipIf(!haveAdminCreds)(
  "notification preferences gate real fan-out (F211: AS-391)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let actorUserId: string;
    let actorClient: SupabaseClient;
    let assigneeUserId: string;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F211 preferences fanout workspace", slug: `f211-fanout-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F211 project", visibility: "workspace" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to create project: ${projectErr?.message}`);
      projectId = project.id;

      async function createActiveMember(label: string) {
        const email = `f211-${label}-${uniqueSuffix}@example.com`;
        const password = "Test-password-1!";
        const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (authErr || !auth.user) throw new Error(`Failed to create ${label}: ${authErr?.message}`);
        createdUserIds.push(auth.user.id);
        const { error: memberErr } = await adminClient.from("workspace_members").insert({
          workspace_id: workspaceId,
          user_id: auth.user.id,
          role: "member",
          status: "active",
        });
        if (memberErr) throw new Error(`Failed to seed ${label} membership: ${memberErr.message}`);
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
        if (signInErr) throw new Error(`Failed to sign in ${label}: ${signInErr.message}`);
        return { userId: auth.user.id, client };
      }

      const actor = await createActiveMember("actor");
      actorUserId = actor.userId;
      actorClient = actor.client;

      const assignee = await createActiveMember("assignee");
      assigneeUserId = assignee.userId;
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("projects").delete().eq("id", projectId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    it("test_AS_391_disabling_task_assigned_in_app_means_assigning_a_task_creates_no_notification_row_for_that_user", async () => {
      // The assignee disables their own task_assigned in-app preference
      // before the event fires — this is the real user-facing shape of
      // AS-391 ("a user configures which notification types they
      // receive").
      const { error: prefErr } = await adminClient
        .from("notification_preferences")
        .update({ task_assigned_in_app: false })
        .eq("user_id", assigneeUserId);
      expect(prefErr).toBeNull();

      sessionClientForMock = actorClient;
      const { assignTask } = await import("@/lib/actions/tasks");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F211 preferences task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const result = await assignTask(task.id, assigneeUserId);
      expect(result.ok).toBe(true);

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "task_assigned")
        .eq("user_id", assigneeUserId);
      expect(readErr).toBeNull();
      // AS-391's whole point: the preference is disabled, so no
      // notification row exists at all for this user, not merely one
      // that's hidden client-side.
      expect(rows).toEqual([]);
    });

    it("test_AS_391_negative_a_second_assignee_with_the_default_preference_still_gets_notified_for_the_same_event", async () => {
      // Control case in the same test file: proves the filter is
      // per-recipient, not an accidental global "notifications are
      // broken" false negative for the disabled-preference test above.
      const { data: secondAssignee, error: secondErr } = await adminClient.auth.admin.createUser({
        email: `f211-assignee2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (secondErr || !secondAssignee.user) throw new Error("Failed to create second assignee");
      createdUserIds.push(secondAssignee.user.id);
      await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: secondAssignee.user.id,
        role: "member",
        status: "active",
      });

      sessionClientForMock = actorClient;
      const { assignTask } = await import("@/lib/actions/tasks");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F211 control task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const result = await assignTask(task.id, secondAssignee.user.id);
      expect(result.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "task_assigned")
        .eq("user_id", secondAssignee.user.id);
      expect(rows).toHaveLength(1);
    });

    // F307 (AS-391 follow-up, FU-10 from M15 scrutiny): the scrutiny
    // report noted only task_assigned's gating had end-to-end coverage.
    // These three tests prove the same real skip for mention,
    // comment_reply, and watcher_update — the other three in-app kinds
    // filterRecipientsByInAppPreference/IN_APP_COLUMN_BY_KIND gate.

    async function createActiveMemberInline(label: string) {
      const email = `f211-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
      const password = "Test-password-1!";
      const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authErr || !auth.user) throw new Error(`Failed to create ${label}: ${authErr?.message}`);
      createdUserIds.push(auth.user.id);
      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: auth.user.id,
        role: "member",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed ${label} membership: ${memberErr.message}`);
      return auth.user.id;
    }

    it("test_AS_391_disabling_mention_in_app_means_mentioning_a_user_in_a_comment_creates_no_notification_row_for_them", async () => {
      const mentionedUserId = await createActiveMemberInline("mention-target");

      const { error: prefErr } = await adminClient
        .from("notification_preferences")
        .update({ mention_in_app: false })
        .eq("user_id", mentionedUserId);
      expect(prefErr).toBeNull();

      sessionClientForMock = actorClient;
      const { addComment } = await import("@/lib/actions/comments");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F211 mention gating task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hey " },
              { type: "mention", attrs: { id: mentionedUserId } },
            ],
          },
        ],
      };

      const result = await addComment(task.id, `hey @${mentionedUserId}`, bodyJson as never);
      expect(result.ok).toBe(true);

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "mention")
        .eq("user_id", mentionedUserId);
      expect(readErr).toBeNull();
      expect(rows).toEqual([]);
    });

    it("test_AS_391_disabling_comment_reply_in_app_means_a_new_comment_creates_no_notification_row_for_an_existing_watcher", async () => {
      const watcherUserId = await createActiveMemberInline("comment-watcher");

      const { error: prefErr } = await adminClient
        .from("notification_preferences")
        .update({ comment_reply_in_app: false })
        .eq("user_id", watcherUserId);
      expect(prefErr).toBeNull();

      sessionClientForMock = actorClient;
      const { addComment } = await import("@/lib/actions/comments");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F211 comment_reply gating task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      // Seed the watcher directly (F164's own auto-watch upsert convention)
      // — a plain existing watcher, not the commenter and not mentioned,
      // so any notification they'd get is exactly the comment_reply kind
      // this test is gating.
      const { error: watcherErr } = await adminClient.from("task_watchers").upsert(
        { task_id: task.id, user_id: watcherUserId, is_watching: true },
        { onConflict: "task_id,user_id" },
      );
      expect(watcherErr).toBeNull();

      const result = await addComment(task.id, "no mentions here", {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "no mentions here" }] }],
      } as never);
      expect(result.ok).toBe(true);

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "comment_reply")
        .eq("user_id", watcherUserId);
      expect(readErr).toBeNull();
      expect(rows).toEqual([]);
    });

    it("test_AS_391_disabling_watcher_update_in_app_means_a_status_change_creates_no_notification_row_for_an_existing_watcher", async () => {
      const watcherUserId = await createActiveMemberInline("status-watcher");

      const { error: prefErr } = await adminClient
        .from("notification_preferences")
        .update({ watcher_update_in_app: false })
        .eq("user_id", watcherUserId);
      expect(prefErr).toBeNull();

      sessionClientForMock = actorClient;
      const { moveTaskStatus } = await import("@/lib/actions/tasks");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F211 watcher_update gating task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const { error: watcherErr } = await adminClient.from("task_watchers").upsert(
        { task_id: task.id, user_id: watcherUserId, is_watching: true },
        { onConflict: "task_id,user_id" },
      );
      expect(watcherErr).toBeNull();

      const result = await moveTaskStatus(task.id, "in_progress");
      expect(result.ok).toBe(true);

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "watcher_update")
        .eq("user_id", watcherUserId);
      expect(readErr).toBeNull();
      expect(rows).toEqual([]);
    });
  },
);
