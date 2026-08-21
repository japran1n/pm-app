// Integration tests for F128 (AS-216, AS-217): the workspace "viewer" role
// is read-only everywhere.
//
// Two layers are proven independently, per the feature's Definition of
// done ("your test must prove server rejection independent of UI hiding"):
//
//  1. Server Action layer: calling lib/actions/*.ts's mutating Server
//     Actions directly (bypassing any UI control entirely) as a viewer
//     returns `{ ok: false }`, never `{ ok: true }` — proving the
//     rejection is server-side, not merely a hidden button.
//  2. RLS layer: a viewer's real Supabase session, using the publishable
//     key (no admin/service-role bypass), is rejected by the database
//     itself on direct INSERT/UPDATE — proving a client that skips the
//     Server Action entirely (curl, devtools, stale UI state) still can't
//     write.
//
// Both layers also assert the matching positive case (AS-216: a viewer can
// still read everything) so this test can't pass by accident from an
// over-broad deny-all policy.
//
// Mirrors tests/integration/delete-comment.test.ts's loadDotEnv/skipIf/
// `@/lib/supabase/server` mock conventions.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
    "F128: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "Viewer role is read-only everywhere (F128: AS-216, AS-217)",
  () => {
    let adminClient: SupabaseClient;
    let viewerSessionClient: SupabaseClient;
    let memberSessionClient: SupabaseClient;

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let commentId: string;
    let viewerUserId: string;
    let memberUserId: string;

    const cleanupUserIds: string[] = [];

    beforeAll(async () => {
      const { createTask } = await import("@/lib/actions/tasks");
      void createTask; // ensures the module graph (and its imports) resolve early

      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F128 Viewer RLS Workspace",
          slug: `f128-viewer-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      async function makeUser(label: string) {
        const email = `f128-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        cleanupUserIds.push(data.user.id);
        return { id: data.user.id, email };
      }

      const viewer = await makeUser("viewer");
      viewerUserId = viewer.id;
      const member = await makeUser("member");
      memberUserId = member.id;

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: viewerUserId,
            role: "viewer",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F128 Project ${uniqueSuffix}`,
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
          title: `F128 Task ${uniqueSuffix}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;

      const { data: comment, error: commentErr } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: memberUserId,
          text: "F128 pre-existing comment",
        })
        .select("id")
        .single();
      if (commentErr || !comment) {
        throw new Error(`Failed to create test comment: ${commentErr?.message}`);
      }
      commentId = comment.id;

      viewerSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: viewerSignInErr } =
        await viewerSessionClient.auth.signInWithPassword({
          email: viewer.email,
          password: "Test-password-1!",
        });
      if (viewerSignInErr) {
        throw new Error(`Failed to sign in viewer: ${viewerSignInErr.message}`);
      }

      memberSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberSignInErr } =
        await memberSessionClient.auth.signInWithPassword({
          email: member.email,
          password: "Test-password-1!",
        });
      if (memberSignInErr) {
        throw new Error(`Failed to sign in member: ${memberSignInErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      if (commentId) {
        await adminClient.from("comments").delete().eq("id", commentId);
      }
      if (taskId) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of cleanupUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    // --- AS-216: a viewer can read everything ---------------------------

    it("AS-216: a viewer can SELECT the project's tasks", async () => {
      const { data, error } = await viewerSessionClient
        .from("tasks")
        .select("id, title")
        .eq("id", taskId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("AS-216: a viewer can SELECT the task's comments", async () => {
      const { data, error } = await viewerSessionClient
        .from("comments")
        .select("id, text")
        .eq("id", commentId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    // --- AS-216/AS-217: a viewer's write is rejected at the RLS layer ---
    // (direct Supabase call, bypassing every Server Action)

    it("AS-217: a viewer cannot INSERT a task directly against Supabase (RLS)", async () => {
      const { data, error } = await viewerSessionClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "should be rejected by RLS",
          author_id: viewerUserId,
        })
        .select("id");
      // RLS with-check violations surface as a Postgres error on insert
      // (unlike a filtered SELECT, which silently returns zero rows).
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("AS-217: a viewer cannot UPDATE a task directly against Supabase (RLS)", async () => {
      const { data, error } = await viewerSessionClient
        .from("tasks")
        .update({ description: "should not be applied by a viewer" })
        .eq("id", taskId)
        .select("id");
      // A failed UPDATE under RLS (USING clause excludes the row) returns
      // no error but zero affected rows — verified against the admin
      // client below that the row was genuinely untouched.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: unchanged } = await adminClient
        .from("tasks")
        .select("description")
        .eq("id", taskId)
        .single();
      expect(unchanged?.description).not.toBe(
        "should not be applied by a viewer",
      );
    });

    it("AS-217: a viewer cannot INSERT a comment directly against Supabase (RLS)", async () => {
      const { data, error } = await viewerSessionClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: viewerUserId,
          text: "should be rejected by RLS",
        })
        .select("id");
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("AS-217: a viewer cannot INSERT a time entry directly against Supabase (RLS)", async () => {
      const { data, error } = await viewerSessionClient
        .from("time_entries")
        .insert({
          task_id: taskId,
          user_id: viewerUserId,
          minutes: 30,
        })
        .select("id");
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("control: a plain member CAN still INSERT a task directly against Supabase (RLS regression guard)", async () => {
      const { data, error } = await memberSessionClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "member-created task, should succeed",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data?.id) {
        await adminClient.from("tasks").delete().eq("id", data.id);
      }
    });

    // --- AS-217: Server Action layer — direct call, no UI involved ------

    it("AS-217: createTask Server Action rejects a viewer caller (not just hidden in the UI)", async () => {
      currentTestUserId = viewerUserId;
      const { createTask } = await import("@/lib/actions/tasks");
      const result = await createTask(projectId, "should be rejected");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain("viewer");
      }
    });

    it("AS-217: editTask Server Action rejects a viewer caller", async () => {
      currentTestUserId = viewerUserId;
      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, {
        description: "should be rejected",
      });
      expect(result.ok).toBe(false);
    });

    it("AS-217: deleteTask Server Action rejects a viewer caller", async () => {
      currentTestUserId = viewerUserId;
      const { deleteTask } = await import("@/lib/actions/tasks");
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(false);
    });

    it("AS-217: addComment Server Action rejects a viewer caller", async () => {
      currentTestUserId = viewerUserId;
      const { addComment } = await import("@/lib/actions/comments");
      const result = await addComment(taskId, "should be rejected");
      expect(result.ok).toBe(false);
    });

    it("AS-217: logTimeEntry Server Action rejects a viewer caller", async () => {
      currentTestUserId = viewerUserId;
      const { logTimeEntry } = await import("@/lib/actions/time-entries");
      const result = await logTimeEntry(
        taskId,
        15,
        true,
        new Date().toISOString().slice(0, 10),
      );
      expect(result.ok).toBe(false);
    });

    it("AS-217: createProject Server Action rejects a viewer caller", async () => {
      currentTestUserId = viewerUserId;
      const { createProject } = await import("@/lib/actions/projects");
      const result = await createProject(workspaceId, "should be rejected");
      expect(result.ok).toBe(false);
    });

    it("control: createTask Server Action still succeeds for a plain member (regression guard)", async () => {
      currentTestUserId = memberUserId;
      const { createTask } = await import("@/lib/actions/tasks");
      const result = await createTask(projectId, "member-created via action");
      expect(result.ok).toBe(true);
      if (result.ok) {
        await adminClient.from("tasks").delete().eq("id", result.data.id);
      }
    });
  },
);
