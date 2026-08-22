// Integration test for F180 (AS-324, AS-325, AS-326, AS-327), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/edit-task.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a
// real throwaway Supabase Auth user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F180: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

import { vi } from "vitest";

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
  "duplicateTask (F180: AS-324, AS-325, AS-326, AS-327)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let authorUserId: string;
    let assigneeUserId: string;
    let viewerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F180 Test Workspace",
          slug: `f180-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const authorEmail = `f180-author-${uniqueSuffix}@example.com`;
      const { data: authorAuth, error: authorAuthErr } =
        await adminClient.auth.admin.createUser({
          email: authorEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authorAuthErr || !authorAuth.user) {
        throw new Error(`Failed to create author user: ${authorAuthErr?.message}`);
      }
      authorUserId = authorAuth.user.id;
      createdUserIds.push(authorUserId);

      const assigneeEmail = `f180-assignee-${uniqueSuffix}@example.com`;
      const { data: assigneeAuth, error: assigneeAuthErr } =
        await adminClient.auth.admin.createUser({
          email: assigneeEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (assigneeAuthErr || !assigneeAuth.user) {
        throw new Error(
          `Failed to create assignee user: ${assigneeAuthErr?.message}`,
        );
      }
      assigneeUserId = assigneeAuth.user.id;
      createdUserIds.push(assigneeUserId);

      const viewerEmail = `f180-viewer-${uniqueSuffix}@example.com`;
      const { data: viewerAuth, error: viewerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: viewerEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (viewerAuthErr || !viewerAuth.user) {
        throw new Error(`Failed to create viewer user: ${viewerAuthErr?.message}`);
      }
      viewerUserId = viewerAuth.user.id;
      createdUserIds.push(viewerUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: authorUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: assigneeUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: viewerUserId,
            role: "viewer",
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
          name: `F180 Project ${uniqueSuffix}`,
          created_by: authorUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
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
    });

    async function makeTask(overrides: {
      title?: string;
      status?: string;
      position?: number;
    } = {}): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: overrides.title ?? `F180 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
          status: overrides.status ?? "todo",
          position: overrides.position ?? 1000,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-324: duplication produces a copy with a marked title (Copy of <original>)", async () => {
      const { duplicateTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({ title: "Original Title" });

      currentTestUserId = authorUserId;

      const result = await duplicateTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.title).toBe("Copy of Original Title");
      expect(result.data.id).not.toBe(taskId);
    });

    it("AS-325: the duplicate copies description, priority, assignees, tags, checklist, estimate", async () => {
      const { duplicateTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({ title: "Rich Source" });

      await adminClient
        .from("tasks")
        .update({
          description: "Original description",
          priority: "high",
          tags: ["urgent", "backend"],
          estimate_minutes: 45,
        })
        .eq("id", taskId);

      await adminClient.from("task_assignees").insert({
        task_id: taskId,
        user_id: assigneeUserId,
        assigned_by: authorUserId,
      });

      await adminClient.from("checklist_items").insert([
        { task_id: taskId, content: "Step one", position: 1000 },
        { task_id: taskId, content: "Step two", position: 2000 },
      ]);

      currentTestUserId = authorUserId;
      const result = await duplicateTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: newTaskRow } = await adminClient
        .from("tasks")
        .select("description, priority, tags, estimate_minutes")
        .eq("id", result.data.id)
        .single();

      expect(newTaskRow?.description).toBe("Original description");
      expect(newTaskRow?.priority).toBe("high");
      expect(newTaskRow?.tags).toEqual(["urgent", "backend"]);
      expect(newTaskRow?.estimate_minutes).toBe(45);

      const { data: newAssignees } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", result.data.id);
      expect((newAssignees ?? []).map((r) => r.user_id)).toEqual([
        assigneeUserId,
      ]);

      const { data: newChecklist } = await adminClient
        .from("checklist_items")
        .select("content, position, is_checked")
        .eq("task_id", result.data.id)
        .order("position", { ascending: true });
      expect((newChecklist ?? []).map((r) => r.content)).toEqual([
        "Step one",
        "Step two",
      ]);
      expect((newChecklist ?? []).every((r) => r.is_checked === false)).toBe(
        true,
      );
    });

    it("AS-326: the duplicate does NOT copy comments, attachments, logged time, or the key — it gets its own key", async () => {
      const { duplicateTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({ title: "Has History" });

      await adminClient.from("comments").insert({
        task_id: taskId,
        user_id: authorUserId,
        text: "An old comment",
      });

      currentTestUserId = authorUserId;
      const result = await duplicateTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: sourceRow } = await adminClient
        .from("tasks")
        .select("number")
        .eq("id", taskId)
        .single();

      expect(result.data.number).not.toBe(sourceRow?.number);
      expect(typeof result.data.number).toBe("number");

      const { data: newComments } = await adminClient
        .from("comments")
        .select("id")
        .eq("task_id", result.data.id);
      expect(newComments ?? []).toHaveLength(0);

      const { data: newAttachments } = await adminClient
        .from("attachments")
        .select("id")
        .eq("task_id", result.data.id);
      expect(newAttachments ?? []).toHaveLength(0);
    });

    it("AS-327: the duplicate lands in the same project and status, positioned right after the original", async () => {
      const { duplicateTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({
        title: "Positioned Source",
        status: "in_progress",
        position: 1000,
      });
      // A successor already in the same column, further along than the
      // source, so the duplicate's position must land strictly between
      // the two.
      const successorId = await makeTask({
        title: "Successor",
        status: "in_progress",
        position: 2000,
      });

      currentTestUserId = authorUserId;
      const result = await duplicateTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: sourceRow } = await adminClient
        .from("tasks")
        .select("project_id, status, position")
        .eq("id", taskId)
        .single();
      const { data: successorRow } = await adminClient
        .from("tasks")
        .select("position")
        .eq("id", successorId)
        .single();

      expect(result.data.projectId).toBe(sourceRow?.project_id);
      expect(result.data.status).toBe(sourceRow?.status);
      expect(result.data.position).toBeGreaterThan(sourceRow?.position ?? 0);
      expect(result.data.position).toBeLessThan(successorRow?.position ?? 0);
    });

    it("AS-326 negative / permission: a viewer cannot duplicate a task", async () => {
      const { duplicateTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({ title: "Viewer Blocked" });

      currentTestUserId = viewerUserId;
      const result = await duplicateTask(taskId);

      expect(result.ok).toBe(false);
    });

    it("negative: duplicating a nonexistent task returns an error", async () => {
      const { duplicateTask } = await import("@/lib/actions/tasks");
      currentTestUserId = authorUserId;

      const result = await duplicateTask("00000000-0000-0000-0000-000000000000");

      expect(result.ok).toBe(false);
    });
  },
);
