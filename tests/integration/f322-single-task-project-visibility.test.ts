// Integration test for F322 (AS-227, AS-228 — M15 pass-6 scrutiny finding
// B2, blocker-class privilege escalation), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/bulk-update-tasks.test.ts and
// tests/integration/task-assignees-multi.test.ts.
//
// Before F322, every single-task mutation Server Action in
// lib/actions/tasks.ts wrote through the service-role ADMIN client (RLS
// bypassed by design) after checking only workspace membership plus a role
// predicate — never whether the caller could actually SEE the task's
// PROJECT. A workspace member who was active but NOT an explicit member of
// a PRIVATE project could edit/move/reassign/delete/restore/duplicate/
// create that project's tasks directly. This is exactly the class of bug
// tests/integration/rls-project-visibility.test.ts could never catch (every
// case there queries the database directly under the outsider's own RLS
// session — the one layer these Server Actions bypass). Every test below
// drives the ACTUAL Server Action (never a raw query) and asserts real DB
// state, not just the returned `ok` flag.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test.

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
import { poolUserId } from "../helpers/auth";

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
    "F322: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "F322 single-task mutation actions enforce private-project visibility (AS-227, AS-228)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    // Workspace-visible project — every active member can act on its tasks.
    let publicProjectId: string;
    // Private project — only ownerUserId (workspace owner) and
    // insiderUserId (explicit project_members row) can access it.
    let privateProjectId: string;

    let ownerUserId: string; // workspace owner — always allowed (positive control)
    let insiderUserId: string; // active member, explicit project_members row on privateProjectId (positive control)
    let outsiderUserId: string; // active member, NO access to privateProjectId (negative control)

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F322 Test Workspace",
          slug: `f322-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      // F126: pooled identities (see tests/helpers/auth.ts) — NOT pushed
      // onto createdUserIds, so this file's afterAll never deletes them.
      ownerUserId = await poolUserId(0);
      insiderUserId = await poolUserId(1);
      outsiderUserId = await poolUserId(2);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: ownerUserId,
            role: "owner",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: insiderUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: outsiderUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: pubProj, error: pubProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F322 Public Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (pubProjErr || !pubProj) {
        throw new Error(
          `Failed to create public test project: ${pubProjErr?.message}`,
        );
      }
      publicProjectId = pubProj.id;
      createdProjectIds.push(publicProjectId);

      const { data: privProj, error: privProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F322 Private Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privProjErr || !privProj) {
        throw new Error(
          `Failed to create private test project: ${privProjErr?.message}`,
        );
      }
      privateProjectId = privProj.id;
      createdProjectIds.push(privateProjectId);

      // Only insiderUserId has an explicit project_members row —
      // outsiderUserId is deliberately never added. ownerUserId needs none
      // (workspace owners can always see every project — positive control
      // for that rule specifically).
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: insiderUserId,
        project_role: "member",
      });
      if (pmErr) {
        throw new Error(`Failed to seed project_members: ${pmErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("project_members").delete().eq("project_id", pId);
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

    async function makeTask(
      targetProjectId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: targetProjectId,
          title: `F322 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: ownerUserId,
          status: "todo",
          ...overrides,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    // ------------------------------------------------------------------
    // editTask
    // ------------------------------------------------------------------
    describe("editTask", () => {
      it("AS-227/AS-228: an outsider cannot edit a private project's task; the task is genuinely unchanged", async () => {
        const { editTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId, { title: "Original title" });

        currentTestUserId = outsiderUserId;
        const result = await editTask(taskId, { title: "Hacked title" });

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("title")
          .eq("id", taskId)
          .single();
        expect(row?.title).toBe("Original title");
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both edit the private project's task", async () => {
        const { editTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId, { title: "Owner task" });
        currentTestUserId = ownerUserId;
        const ownerResult = await editTask(ownerTask, { title: "Edited by owner" });
        expect(ownerResult.ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId, {
          title: "Insider task",
        });
        currentTestUserId = insiderUserId;
        const insiderResult = await editTask(insiderTask, {
          title: "Edited by insider",
        });
        expect(insiderResult.ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, title")
          .in("id", [ownerTask, insiderTask]);
        const byId = new Map((rows ?? []).map((r) => [r.id, r.title]));
        expect(byId.get(ownerTask)).toBe("Edited by owner");
        expect(byId.get(insiderTask)).toBe("Edited by insider");
      });

      it("AS-227/AS-228 regression: a plain member still edits a workspace-visible project's task", async () => {
        const { editTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId, { title: "Public original" });

        currentTestUserId = outsiderUserId;
        const result = await editTask(taskId, { title: "Public edited" });

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("title")
          .eq("id", taskId)
          .single();
        expect(row?.title).toBe("Public edited");
      });
    });

    // ------------------------------------------------------------------
    // moveTaskStatus
    // ------------------------------------------------------------------
    describe("moveTaskStatus", () => {
      it("AS-227/AS-228: an outsider cannot move a private project's task; status is genuinely unchanged", async () => {
        const { moveTaskStatus } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await moveTaskStatus(taskId, "done");

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("status")
          .eq("id", taskId)
          .single();
        expect(row?.status).toBe("todo");
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both move the private project's task", async () => {
        const { moveTaskStatus } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        expect((await moveTaskStatus(ownerTask, "in_progress")).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        expect((await moveTaskStatus(insiderTask, "in_progress")).ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, status")
          .in("id", [ownerTask, insiderTask]);
        expect(rows?.every((r) => r.status === "in_progress")).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still moves a workspace-visible project's task", async () => {
        const { moveTaskStatus } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await moveTaskStatus(taskId, "in_progress");

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("status")
          .eq("id", taskId)
          .single();
        expect(row?.status).toBe("in_progress");
      });
    });

    // ------------------------------------------------------------------
    // moveAndReorderTask
    // ------------------------------------------------------------------
    describe("moveAndReorderTask", () => {
      it("AS-227/AS-228: an outsider cannot move-and-reorder a private project's task; row is genuinely unchanged", async () => {
        const { moveAndReorderTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId, { position: 100 });

        currentTestUserId = outsiderUserId;
        const result = await moveAndReorderTask(taskId, "in_review", 500);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("status, position")
          .eq("id", taskId)
          .single();
        expect(row?.status).toBe("todo");
        expect(row?.position).toBe(100);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both move-and-reorder the private project's task", async () => {
        const { moveAndReorderTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId, { position: 100 });
        currentTestUserId = ownerUserId;
        expect((await moveAndReorderTask(ownerTask, "in_review", 500)).ok).toBe(
          true,
        );

        const insiderTask = await makeTask(privateProjectId, { position: 100 });
        currentTestUserId = insiderUserId;
        expect(
          (await moveAndReorderTask(insiderTask, "in_review", 500)).ok,
        ).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, status, position")
          .in("id", [ownerTask, insiderTask]);
        expect(rows?.every((r) => r.status === "in_review")).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still move-and-reorders a workspace-visible project's task", async () => {
        const { moveAndReorderTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId, { position: 100 });

        currentTestUserId = outsiderUserId;
        const result = await moveAndReorderTask(taskId, "in_review", 500);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("status")
          .eq("id", taskId)
          .single();
        expect(row?.status).toBe("in_review");
      });
    });

    // ------------------------------------------------------------------
    // reorderTask
    // ------------------------------------------------------------------
    describe("reorderTask", () => {
      it("AS-227/AS-228: an outsider cannot reorder a private project's task; position is genuinely unchanged", async () => {
        const { reorderTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId, { position: 100 });

        currentTestUserId = outsiderUserId;
        const result = await reorderTask(taskId, 999);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("position")
          .eq("id", taskId)
          .single();
        expect(row?.position).toBe(100);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both reorder the private project's task", async () => {
        const { reorderTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId, { position: 100 });
        currentTestUserId = ownerUserId;
        expect((await reorderTask(ownerTask, 999)).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId, { position: 100 });
        currentTestUserId = insiderUserId;
        expect((await reorderTask(insiderTask, 999)).ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, position")
          .in("id", [ownerTask, insiderTask]);
        expect(rows?.every((r) => r.position === 999)).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still reorders a workspace-visible project's task", async () => {
        const { reorderTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId, { position: 100 });

        currentTestUserId = outsiderUserId;
        const result = await reorderTask(taskId, 999);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("position")
          .eq("id", taskId)
          .single();
        expect(row?.position).toBe(999);
      });
    });

    // ------------------------------------------------------------------
    // deleteTask
    // ------------------------------------------------------------------
    describe("deleteTask", () => {
      it("AS-227/AS-228: an outsider cannot delete a private project's task; the task is genuinely still live", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await deleteTask(taskId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("deleted_at")
          .eq("id", taskId)
          .single();
        expect(row?.deleted_at).toBeNull();
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both delete the private project's task", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        expect((await deleteTask(ownerTask)).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        expect((await deleteTask(insiderTask)).ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, deleted_at")
          .in("id", [ownerTask, insiderTask]);
        expect(rows?.every((r) => r.deleted_at !== null)).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still deletes a workspace-visible project's task", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await deleteTask(taskId);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("deleted_at")
          .eq("id", taskId)
          .single();
        expect(row?.deleted_at).not.toBeNull();
      });
    });

    // ------------------------------------------------------------------
    // restoreTask
    // ------------------------------------------------------------------
    describe("restoreTask", () => {
      async function makeDeletedTask(targetProjectId: string): Promise<string> {
        const taskId = await makeTask(targetProjectId);
        const { error } = await adminClient
          .from("tasks")
          .update({ deleted_at: new Date().toISOString(), deleted_by: ownerUserId })
          .eq("id", taskId);
        if (error) throw new Error(`Failed to soft-delete seed task: ${error.message}`);
        return taskId;
      }

      it("AS-227/AS-228: an outsider cannot restore a private project's task; it stays deleted", async () => {
        const { restoreTask } = await import("@/lib/actions/tasks");
        const taskId = await makeDeletedTask(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await restoreTask(taskId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("deleted_at")
          .eq("id", taskId)
          .single();
        expect(row?.deleted_at).not.toBeNull();
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both restore the private project's task", async () => {
        const { restoreTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeDeletedTask(privateProjectId);
        currentTestUserId = ownerUserId;
        expect((await restoreTask(ownerTask)).ok).toBe(true);

        const insiderTask = await makeDeletedTask(privateProjectId);
        currentTestUserId = insiderUserId;
        expect((await restoreTask(insiderTask)).ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, deleted_at")
          .in("id", [ownerTask, insiderTask]);
        expect(rows?.every((r) => r.deleted_at === null)).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still restores a workspace-visible project's task", async () => {
        const { restoreTask } = await import("@/lib/actions/tasks");
        const taskId = await makeDeletedTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await restoreTask(taskId);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("deleted_at")
          .eq("id", taskId)
          .single();
        expect(row?.deleted_at).toBeNull();
      });
    });

    // ------------------------------------------------------------------
    // promoteSubtask
    // ------------------------------------------------------------------
    describe("promoteSubtask", () => {
      async function makeSubtask(targetProjectId: string): Promise<string> {
        const parentId = await makeTask(targetProjectId);
        return makeTask(targetProjectId, { parent_task_id: parentId });
      }

      it("AS-227/AS-228: an outsider cannot promote a private project's subtask; it stays nested", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");
        const subtaskId = await makeSubtask(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await promoteSubtask(subtaskId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("parent_task_id")
          .eq("id", subtaskId)
          .single();
        expect(row?.parent_task_id).not.toBeNull();
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both promote a private project's subtask", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");

        const ownerSubtask = await makeSubtask(privateProjectId);
        currentTestUserId = ownerUserId;
        expect((await promoteSubtask(ownerSubtask)).ok).toBe(true);

        const insiderSubtask = await makeSubtask(privateProjectId);
        currentTestUserId = insiderUserId;
        expect((await promoteSubtask(insiderSubtask)).ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, parent_task_id")
          .in("id", [ownerSubtask, insiderSubtask]);
        expect(rows?.every((r) => r.parent_task_id === null)).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still promotes a workspace-visible project's subtask", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");
        const subtaskId = await makeSubtask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await promoteSubtask(subtaskId);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("parent_task_id")
          .eq("id", subtaskId)
          .single();
        expect(row?.parent_task_id).toBeNull();
      });
    });

    // ------------------------------------------------------------------
    // updateTaskTags
    // ------------------------------------------------------------------
    describe("updateTaskTags", () => {
      it("AS-227/AS-228: an outsider cannot update tags on a private project's task; tags are genuinely unchanged", async () => {
        const { updateTaskTags } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId, { tags: ["original"] });

        currentTestUserId = outsiderUserId;
        const result = await updateTaskTags(taskId, ["hacked"]);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("tags")
          .eq("id", taskId)
          .single();
        expect(row?.tags).toEqual(["original"]);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both update tags on the private project's task", async () => {
        const { updateTaskTags } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        expect((await updateTaskTags(ownerTask, ["owner-tag"])).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        expect((await updateTaskTags(insiderTask, ["insider-tag"])).ok).toBe(
          true,
        );

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, tags")
          .in("id", [ownerTask, insiderTask]);
        const byId = new Map((rows ?? []).map((r) => [r.id, r.tags]));
        expect(byId.get(ownerTask)).toEqual(["owner-tag"]);
        expect(byId.get(insiderTask)).toEqual(["insider-tag"]);
      });

      it("AS-227/AS-228 regression: a plain member still updates tags on a workspace-visible project's task", async () => {
        const { updateTaskTags } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await updateTaskTags(taskId, ["public-tag"]);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("tags")
          .eq("id", taskId)
          .single();
        expect(row?.tags).toEqual(["public-tag"]);
      });
    });

    // ------------------------------------------------------------------
    // duplicateTask
    // ------------------------------------------------------------------
    describe("duplicateTask", () => {
      async function countTasksInProject(targetProjectId: string): Promise<number> {
        const { count } = await adminClient
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("project_id", targetProjectId);
        return count ?? 0;
      }

      it("AS-227/AS-228: an outsider cannot duplicate a private project's task; no new row is created", async () => {
        const { duplicateTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);
        const before = await countTasksInProject(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await duplicateTask(taskId);

        expect(result.ok).toBe(false);
        const after = await countTasksInProject(privateProjectId);
        expect(after).toBe(before);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both duplicate the private project's task", async () => {
        const { duplicateTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        const ownerResult = await duplicateTask(ownerTask);
        expect(ownerResult.ok).toBe(true);
        if (ownerResult.ok) createdTaskIds.push(ownerResult.data.id);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        const insiderResult = await duplicateTask(insiderTask);
        expect(insiderResult.ok).toBe(true);
        if (insiderResult.ok) createdTaskIds.push(insiderResult.data.id);
      });

      it("AS-227/AS-228 regression: a plain member still duplicates a workspace-visible project's task", async () => {
        const { duplicateTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await duplicateTask(taskId);

        expect(result.ok).toBe(true);
        if (result.ok) createdTaskIds.push(result.data.id);
      });
    });

    // ------------------------------------------------------------------
    // toggleDescriptionChecklistItem
    // ------------------------------------------------------------------
    describe("toggleDescriptionChecklistItem", () => {
      const CHECKLIST_ITEM_ID = "f322-checklist-item";
      const descriptionDoc = {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { id: CHECKLIST_ITEM_ID, checked: false },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Do the thing" }],
                  },
                ],
              },
            ],
          },
        ],
      };

      async function makeTaskWithChecklist(
        targetProjectId: string,
      ): Promise<string> {
        return makeTask(targetProjectId, { description_json: descriptionDoc });
      }

      it("AS-227/AS-228: an outsider cannot toggle a checklist item on a private project's task; it stays unchecked", async () => {
        const { toggleDescriptionChecklistItem } = await import(
          "@/lib/actions/tasks"
        );
        const taskId = await makeTaskWithChecklist(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await toggleDescriptionChecklistItem(
          taskId,
          CHECKLIST_ITEM_ID,
          true,
        );

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("description_json")
          .eq("id", taskId)
          .single();
        const doc = row?.description_json as typeof descriptionDoc;
        const checked = doc.content[0].content[0].attrs.checked;
        expect(checked).toBe(false);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both toggle a checklist item on the private project's task", async () => {
        const { toggleDescriptionChecklistItem } = await import(
          "@/lib/actions/tasks"
        );

        const ownerTask = await makeTaskWithChecklist(privateProjectId);
        currentTestUserId = ownerUserId;
        expect(
          (await toggleDescriptionChecklistItem(ownerTask, CHECKLIST_ITEM_ID, true))
            .ok,
        ).toBe(true);

        const insiderTask = await makeTaskWithChecklist(privateProjectId);
        currentTestUserId = insiderUserId;
        expect(
          (
            await toggleDescriptionChecklistItem(
              insiderTask,
              CHECKLIST_ITEM_ID,
              true,
            )
          ).ok,
        ).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still toggles a checklist item on a workspace-visible project's task", async () => {
        const { toggleDescriptionChecklistItem } = await import(
          "@/lib/actions/tasks"
        );
        const taskId = await makeTaskWithChecklist(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await toggleDescriptionChecklistItem(
          taskId,
          CHECKLIST_ITEM_ID,
          true,
        );

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // assignTask / setTaskAssignees / addTaskAssignee / removeTaskAssignee
    // (all routed through requireAssignActionContext)
    // ------------------------------------------------------------------
    describe("assignTask (and the shared requireAssignActionContext gate)", () => {
      it("AS-227/AS-228: an outsider cannot assign a private project's task to themselves; assignee is genuinely unchanged", async () => {
        const { assignTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        // outsiderUserId is not even a valid assignee candidate for this
        // private project (AS-290), but the CALLER-side check (AS-227/
        // AS-228, what this feature fixes) must reject the call before
        // that candidate check is ever reached — assign the task to the
        // insider (a valid candidate) to isolate the caller-side gate.
        currentTestUserId = outsiderUserId;
        const result = await assignTask(taskId, insiderUserId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("tasks")
          .select("assignee_id")
          .eq("id", taskId)
          .single();
        expect(row?.assignee_id).toBeNull();
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both assign the private project's task", async () => {
        const { assignTask } = await import("@/lib/actions/tasks");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        expect((await assignTask(ownerTask, insiderUserId)).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        expect((await assignTask(insiderTask, insiderUserId)).ok).toBe(true);

        const { data: rows } = await adminClient
          .from("tasks")
          .select("id, assignee_id")
          .in("id", [ownerTask, insiderTask]);
        expect(rows?.every((r) => r.assignee_id === insiderUserId)).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still assigns a workspace-visible project's task", async () => {
        const { assignTask } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await assignTask(taskId, outsiderUserId);

        expect(result.ok).toBe(true);
        const { data: row } = await adminClient
          .from("tasks")
          .select("assignee_id")
          .eq("id", taskId)
          .single();
        expect(row?.assignee_id).toBe(outsiderUserId);
      });
    });

    // ------------------------------------------------------------------
    // createTaskForUser (via createTask) — same class of bug, same file:
    // an outsider could otherwise silently create a task INSIDE a private
    // project they have no access to.
    // ------------------------------------------------------------------
    describe("createTask (createTaskForUser)", () => {
      it("AS-227/AS-228: an outsider cannot create a task inside a private project", async () => {
        const { createTask } = await import("@/lib/actions/tasks");
        const before = await adminClient
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("project_id", privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await createTask(privateProjectId, "Sneaky task");

        expect(result.ok).toBe(false);
        const after = await adminClient
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("project_id", privateProjectId);
        expect(after.count).toBe(before.count);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both create a task inside the private project", async () => {
        const { createTask } = await import("@/lib/actions/tasks");

        currentTestUserId = ownerUserId;
        const ownerResult = await createTask(privateProjectId, "Owner-created task");
        expect(ownerResult.ok).toBe(true);
        if (ownerResult.ok) createdTaskIds.push(ownerResult.data.id);

        currentTestUserId = insiderUserId;
        const insiderResult = await createTask(
          privateProjectId,
          "Insider-created task",
        );
        expect(insiderResult.ok).toBe(true);
        if (insiderResult.ok) createdTaskIds.push(insiderResult.data.id);
      });

      it("AS-227/AS-228 regression: a plain member still creates a task inside a workspace-visible project", async () => {
        const { createTask } = await import("@/lib/actions/tasks");

        currentTestUserId = outsiderUserId;
        const result = await createTask(publicProjectId, "Public created task");

        expect(result.ok).toBe(true);
        if (result.ok) createdTaskIds.push(result.data.id);
      });
    });
  },
);
