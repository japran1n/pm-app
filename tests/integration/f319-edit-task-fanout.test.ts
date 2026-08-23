// F319 (M15's FIFTH scrutiny pass, finding B2, AS-294): real-Supabase
// integration coverage proving `editTask` (title/priority/due-date/estimate
// edits) actually notifies the task's active watchers, closing the gap
// where moveTaskStatus/moveAndReorderTask (status changes) and addComment
// (new comments) correctly fanned out to watchers, but editTask — despite
// already diffing and activity-logging these exact fields via
// diffTaskFields/writeTaskFieldChanges (F195) — never notified anyone.
//
// Pattern mirrors tests/integration/f306-mutation-fanout.test.ts (F306) and
// tests/integration/notification-fanout.test.ts (F207): `@/lib/supabase/
// server`'s createClient() is mocked to resolve to a REAL, signed-in
// session client per acting user, so the caller's actual auth.uid() flows
// into write_task_activity_entry/create_notification's SECURITY DEFINER
// pinning — a fake getUser()-only object would not carry a real PostgREST
// session for these RPC calls to run through.

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
    "F319: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "F319: editTask notifies watchers of a title/priority/due-date/estimate change (AS-294)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let actorUserId: string;
    let actorClient: SupabaseClient;
    let watcherUserId: string;
    const createdUserIds: string[] = [];
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F319 fanout workspace",
          slug: `f319-fanout-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F319 project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to create project: ${projectErr?.message}`);
      }
      projectId = project.id;

      async function createActiveMember(label: string) {
        const email = `f319-${label}-${uniqueSuffix}@example.com`;
        const password = "Test-password-1!";
        const { data: auth, error: authErr } =
          await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
        if (authErr || !auth.user) {
          throw new Error(`Failed to create ${label}: ${authErr?.message}`);
        }
        createdUserIds.push(auth.user.id);
        const { error: memberErr } = await adminClient
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: auth.user.id,
            role: "member",
            status: "active",
          });
        if (memberErr) {
          throw new Error(
            `Failed to seed ${label} membership: ${memberErr.message}`,
          );
        }
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error: signInErr } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) {
          throw new Error(`Failed to sign in ${label}: ${signInErr.message}`);
        }
        return { userId: auth.user.id, client };
      }

      const actor = await createActiveMember("actor");
      actorUserId = actor.userId;
      actorClient = actor.client;

      const watcher = await createActiveMember("watcher");
      watcherUserId = watcher.userId;
    });

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient
          .from("task_activity")
          .delete()
          .in("task_id", createdTaskIds);
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (workspaceId) {
        await adminClient
          .from("notifications")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("projects").delete().eq("id", projectId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    async function makeTask(opts: {
      title?: string;
      priority?: string | null;
    }) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: opts.title ?? `F319 task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: actorUserId,
          status: "todo",
          position: 1000,
          priority: opts.priority ?? "medium",
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id as string;
    }

    it("test_AS_294_editTask_title_change_notifies_the_tasks_watcher", async () => {
      const taskId = await makeTask({ title: "Original title" });
      const { error: watchErr } = await adminClient
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: watcherUserId, is_watching: true });
      if (watchErr) {
        throw new Error(`Failed to seed watcher: ${watchErr.message}`);
      }

      sessionClientForMock = actorClient;
      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { title: "New title" });
      expect(result.ok).toBe(true);

      const { data: notifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", watcherUserId)
        .eq("kind", "watcher_update");

      expect(notifs).not.toBeNull();
      expect(notifs!.length).toBe(1);
      expect(notifs![0].actor_id).toBe(actorUserId);
    });

    it("test_AS_294_editTask_priority_change_notifies_the_tasks_watcher", async () => {
      const taskId = await makeTask({ priority: "low" });
      const { error: watchErr } = await adminClient
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: watcherUserId, is_watching: true });
      if (watchErr) {
        throw new Error(`Failed to seed watcher: ${watchErr.message}`);
      }

      sessionClientForMock = actorClient;
      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { priority: "urgent" });
      expect(result.ok).toBe(true);

      const { data: notifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", watcherUserId)
        .eq("kind", "watcher_update");

      expect(notifs).not.toBeNull();
      expect(notifs!.length).toBe(1);
    });

    it("test_AS_294_editTask_with_no_actual_field_changes_notifies_nobody", async () => {
      const taskId = await makeTask({ title: "Unchanged title" });
      const { error: watchErr } = await adminClient
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: watcherUserId, is_watching: true });
      if (watchErr) {
        throw new Error(`Failed to seed watcher: ${watchErr.message}`);
      }

      sessionClientForMock = actorClient;
      const { editTask } = await import("@/lib/actions/tasks");
      // Re-save the exact same title — diffTaskFields produces zero
      // changes for this call, so no activity AND no notification should
      // fire, matching this codebase's "diff first, only act on real
      // changes" convention.
      const result = await editTask(taskId, { title: "Unchanged title" });
      expect(result.ok).toBe(true);

      const { data: notifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", watcherUserId)
        .eq("kind", "watcher_update");

      expect(notifs).not.toBeNull();
      expect(notifs!.length).toBe(0);
    });

    it("test_AS_294_AS_384_editTask_never_notifies_the_actor_even_if_they_are_their_own_watcher", async () => {
      const taskId = await makeTask({ title: "Self-watched title" });
      const { error: watchErr } = await adminClient
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: actorUserId, is_watching: true });
      if (watchErr) {
        throw new Error(`Failed to seed self-watch: ${watchErr.message}`);
      }

      sessionClientForMock = actorClient;
      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { title: "Self-watched title, edited" });
      expect(result.ok).toBe(true);

      const { data: notifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", actorUserId)
        .eq("kind", "watcher_update");

      expect(notifs).not.toBeNull();
      expect(notifs!.length).toBe(0);
    });
  },
);
