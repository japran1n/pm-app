// Integration test for F165 (AS-297: "the task detail view shows the
// current watchers"). Exercises the real end-to-end wiring the F167
// session's own lesson warned about — getTaskDetail's query layer must
// actually select task_watchers, filtered to is_watching = true, not just
// render a component that looks right in isolation. Same
// loadDotEnv/skipIf/mocked-session-client pattern as
// tests/integration/watchers.test.ts (F164), since getTaskDetail also
// resolves the calling user's own id from the mocked
// `@/lib/supabase/server`'s createClient() session, and watchTask/
// unwatchTask write through that same caller session.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F165: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentSessionClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "getTaskDetail watchers wiring (F165: AS-297)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberEmail: string;
    let memberPassword: string;
    let memberUserId: string;
    let memberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F165 Test Workspace",
          slug: `f165-watchers-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f165-member-${uniqueSuffix}@example.com`;
      memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
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
          name: `F165 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F165 Task ${uniqueSuffix}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;

      memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in member test user: ${signInErr.message}`);
      }
    });

    beforeEach(() => {
      currentSessionClient = memberClient;
    });

    afterAll(async () => {
      await adminClient.from("task_watchers").delete().eq("task_id", taskId);
      await adminClient.from("tasks").delete().eq("id", taskId);
      await adminClient.from("projects").delete().eq("id", projectId);
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
    });

    it("AS-297: a task with no watchers shows an empty watcher list and isWatching: false", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");

      const result = await getTaskDetail(taskId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.task.watcherIds).toEqual([]);
      expect(result.data.task.isWatching).toBe(false);
    });

    it("AS-297: watching a task via the real watchTask action makes it appear in getTaskDetail's watcher list", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const { watchTask } = await import("@/lib/actions/watchers");

      const watchResult = await watchTask(taskId);
      expect(watchResult.ok).toBe(true);

      const detail = await getTaskDetail(taskId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.data.task.watcherIds).toContain(memberUserId);
      expect(detail.data.task.isWatching).toBe(true);
    });

    it("AS-297: unwatching via the real unwatchTask action removes it from getTaskDetail's watcher list", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const { watchTask, unwatchTask } = await import("@/lib/actions/watchers");

      await watchTask(taskId);
      const unwatchResult = await unwatchTask(taskId);
      expect(unwatchResult.ok).toBe(true);

      const detail = await getTaskDetail(taskId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.data.task.watcherIds).not.toContain(memberUserId);
      expect(detail.data.task.isWatching).toBe(false);
    });

    it("AS-297: an explicit opt-out (is_watching: false row) never surfaces as a watcher, distinguishing 'row exists' from 'currently watching'", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const { unwatchTask } = await import("@/lib/actions/watchers");

      // unwatchTask on a task never watched still writes a durable
      // is_watching: false row (F164's own durability rule) — that row
      // must not be mistaken for a live watcher by getTaskDetail's query.
      const result = await unwatchTask(taskId);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("task_watchers")
        .select("is_watching")
        .eq("task_id", taskId)
        .eq("user_id", memberUserId)
        .single();
      expect(row?.is_watching).toBe(false);

      const detail = await getTaskDetail(taskId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.data.task.watcherIds).not.toContain(memberUserId);
      expect(detail.data.task.isWatching).toBe(false);
    });
  },
);
