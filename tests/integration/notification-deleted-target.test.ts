// Integration tests for F210 (AS-390): a notification whose target task is
// deleted, or whose task's project has become inaccessible to the
// recipient (made private, per this feature's "treat both the same way"
// clarified Notes), degrades to a non-clickable row instead of a broken
// link — and is excluded from the unread count. Run against the real
// linked Supabase project, same loadDotEnv/skipIf/admin+session-client
// pattern as tests/integration/notification-mark-read.test.ts (F208) and
// tests/integration/rls-project-visibility.test.ts (F132).

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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F210: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let activeSessionClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "notification degrades gracefully for a deleted/inaccessible target (F210: AS-390)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let recipientUserId: string;
    let recipientEmail: string;
    let recipientSessionClient: SupabaseClient;
    let projectId: string;
    let privateProjectId: string;

    const password = "Test-password-1!";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F210 notifications workspace", slug: `f210-notif-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      recipientEmail = `f210-recipient-${uniqueSuffix}@example.com`;
      const { data: recipientAuth, error: recipientAuthErr } =
        await adminClient.auth.admin.createUser({
          email: recipientEmail,
          password,
          email_confirm: true,
        });
      if (recipientAuthErr || !recipientAuth.user) {
        throw new Error(`Failed to create recipient user: ${recipientAuthErr?.message}`);
      }
      recipientUserId = recipientAuth.user.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: recipientUserId,
        role: "member",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F210 project", visibility: "workspace" })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to seed project: ${projErr?.message}`);
      projectId = proj.id;

      const { data: privProj, error: privProjErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F210 private project", visibility: "workspace" })
        .select("id")
        .single();
      if (privProjErr || !privProj)
        throw new Error(`Failed to seed private-to-be project: ${privProjErr?.message}`);
      privateProjectId = privProj.id;

      recipientSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await recipientSessionClient.auth.signInWithPassword({
        email: recipientEmail,
        password,
      });
      if (signInErr) throw new Error(`Failed to sign in recipient: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
        await adminClient.from("tasks").delete().eq("project_id", projectId);
        await adminClient.from("tasks").delete().eq("project_id", privateProjectId);
        await adminClient.from("projects").delete().eq("id", projectId);
        await adminClient.from("projects").delete().eq("id", privateProjectId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (recipientUserId) await adminClient.auth.admin.deleteUser(recipientUserId);
    });

    it("test_AS_390_notification_for_a_soft_deleted_task_degrades_to_non_clickable_instead_of_a_broken_link", async () => {
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F210 task to delete", author_id: recipientUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const { data: created, error: createErr } = await adminClient.rpc("create_notification", {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "task_assigned",
        p_task_id: task.id,
        p_system: true,
      });
      if (createErr || !created) {
        throw new Error(`Failed to seed notification: ${createErr?.message}`);
      }

      // Soft-delete the task.
      const { error: deleteErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", task.id);
      if (deleteErr) throw new Error(`Failed to soft-delete task: ${deleteErr.message}`);

      activeSessionClient = recipientSessionClient;
      const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
      const { list, unreadCount } = await getNotificationsForWorkspace(workspaceId);

      const row = list.find((item) => item.task?.id === task.id);
      expect(row).toBeTruthy();
      // Degraded: title null (renders "a deleted task", non-clickable per
      // notification-panel.tsx's taskLabel/taskHref), not a stale title
      // that would build a broken link.
      expect(row?.task?.title).toBeNull();
      // Excluded from the unread badge count.
      expect(unreadCount).toBe(0);
    });

    it("test_AS_390_notification_for_a_task_whose_project_became_inaccessible_degrades_the_same_way", async () => {
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F210 task in a project made private",
          author_id: recipientUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const { data: created, error: createErr } = await adminClient.rpc("create_notification", {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "watcher_update",
        p_task_id: task.id,
        p_system: true,
      });
      if (createErr || !created) {
        throw new Error(`Failed to seed notification: ${createErr?.message}`);
      }

      // Sanity: while the project is still workspace-visible, the
      // recipient (a plain workspace member, no project_members row) sees
      // the real task title.
      activeSessionClient = recipientSessionClient;
      const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
      const before = await getNotificationsForWorkspace(workspaceId);
      const beforeRow = before.list.find((item) => item.task?.id === task.id);
      expect(beforeRow?.task?.title).toBe("F210 task in a project made private");
      expect(before.unreadCount).toBeGreaterThanOrEqual(1);

      // Make the project private — recipient has no project_members row
      // and is not an owner/admin, so is_task_visible_to() now excludes
      // this task's rows via RLS.
      const { error: visErr } = await adminClient
        .from("projects")
        .update({ visibility: "private" })
        .eq("id", privateProjectId);
      if (visErr) throw new Error(`Failed to make project private: ${visErr.message}`);

      const after = await getNotificationsForWorkspace(workspaceId);
      const afterRow = after.list.find((item) => item.id === before.list.find((r) => r.task?.id === task.id)?.id);

      // The notification row itself still exists (notifications aren't
      // RLS-scoped to the task's project) but its task degrades exactly
      // like the soft-delete case: title null, non-clickable.
      expect(afterRow).toBeTruthy();
      expect(afterRow?.task?.title).toBeNull();
      expect(afterRow?.task?.id).toBe(task.id);

      // And it's excluded from the unread count now that it's degraded.
      const afterUnreadForThisTask = after.unreadCount;
      expect(afterUnreadForThisTask).toBe(before.unreadCount - 1);
    });
  },
);
