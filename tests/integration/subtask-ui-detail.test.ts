// Integration test for F150 (AS-263, AS-264, AS-275), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf/signed-in-client
// pattern established by tests/integration/board-columns-render.test.ts
// (F042) and tests/integration/subtask-actions.test.ts (F149).
//
// Covers:
//   - AS-263: a child task's getTaskDetail (lib/actions/tasks.ts) result
//     carries enough of its live parent (id, title, projectKey, number)
//     to render and open the "Subtask of ..." breadcrumb — and a
//     top-level task's result carries none of that (`parent: null`,
//     `parentTaskId: null`), so the breadcrumb correctly has nothing to
//     render for it.
//   - AS-264: a parent task's getTaskDetail result carries its live
//     children (status + assigneeId), fetched via the SAME query
//     (Promise.all alongside comments/attachments) rather than a
//     per-child round trip — and lib/tasks/subtask-progress.ts's
//     countSubtaskProgress, run against that real fetched data, produces
//     the correct "N of M done" count. Also proves the Subtasks section
//     reflects a NEWLY added subtask on the very next getTaskDetail call
//     (no caching gap), and that a promoted (detached) subtask
//     disappears from its former parent's children on the next fetch.
//   - AS-275: getProjectBoardTasks (lib/queries/tasks.ts) — deliberately
//     UNCHANGED in its own row-filtering logic by this feature — still
//     returns a child task as its own ordinary row alongside its parent,
//     never hidden/merged/filtered out just because it has a
//     parent_task_id. Also proves the new `subtaskCount` aggregate is
//     correct.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to resolve to a
// real, signed-in Supabase client for an active member of the workspace,
// so both getTaskDetail/createTask/promoteSubtask's `auth.getUser()` calls
// AND getProjectBoardTasks's own RLS-scoped `.from()` queries run under
// the SAME real session a real request would use — same rationale as
// board-columns-render.test.ts's own doc comment.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F150 subtask task-detail UI data (AS-263, AS-264, AS-275)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let projectKey: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F150 Test Workspace",
          slug: `f150-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f150-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create member user: ${memberAuthErr?.message}`,
        );
      }
      const memberUserId = memberAuth.user.id;
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
          name: `F150 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id, key")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      projectKey = proj.key;
      createdProjectIds.push(projectId);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (createdProjectIds.length > 0) {
        await adminClient
          .from("projects")
          .delete()
          .in("id", createdProjectIds);
      }
      if (createdWorkspaceIds.length > 0) {
        await adminClient
          .from("workspace_members")
          .delete()
          .in("workspace_id", createdWorkspaceIds);
        await adminClient
          .from("workspaces")
          .delete()
          .in("id", createdWorkspaceIds);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30000);

    async function makeTask(
      titlePrefix: string,
      status: "todo" | "in_progress" | "in_review" | "done" = "todo",
      parentTaskId?: string,
    ): Promise<string> {
      const { createTask } = await import("@/lib/actions/tasks");
      const result = await createTask(
        projectId,
        `${titlePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        null,
        status,
        null,
        null,
        null,
        parentTaskId ?? null,
      );
      if (!result.ok) {
        throw new Error(`Failed to seed task: ${result.error}`);
      }
      createdTaskIds.push(result.data.id);
      return result.data.id;
    }

    it("test_AS_263_a_childs_task_detail_carries_its_parents_id_title_and_key", async () => {
      const parentId = await makeTask("F150 AS263 Parent");
      const childId = await makeTask("F150 AS263 Child", "todo", parentId);

      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(childId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.parentTaskId).toBe(parentId);
      expect(result.data.task.parent).not.toBeNull();
      expect(result.data.task.parent?.id).toBe(parentId);
      expect(result.data.task.parent?.projectKey).toBe(projectKey);
      expect(typeof result.data.task.parent?.number).toBe("number");
      // A subtask shares its parent's project, so this task's OWN
      // projectId must also equal the project both were seeded into.
      expect(result.data.task.projectId).toBe(projectId);
    });

    it("test_AS_263_negative_a_top_level_tasks_detail_carries_no_parent", async () => {
      const topLevelId = await makeTask("F150 AS263 TopLevel");

      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(topLevelId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.parentTaskId).toBeNull();
      expect(result.data.task.parent).toBeNull();
    });

    it("test_AS_264_a_parents_task_detail_lists_its_live_children_with_status", async () => {
      const parentId = await makeTask("F150 AS264 Parent");
      const doneChildId = await makeTask("F150 AS264 Done Child", "done", parentId);
      const openChildId = await makeTask("F150 AS264 Open Child", "todo", parentId);

      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(parentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const childIds = result.data.task.children?.map((c) => c.id) ?? [];
      expect(childIds).toContain(doneChildId);
      expect(childIds).toContain(openChildId);

      const doneChild = result.data.task.children?.find(
        (c) => c.id === doneChildId,
      );
      const openChild = result.data.task.children?.find(
        (c) => c.id === openChildId,
      );
      expect(doneChild?.status).toBe("done");
      expect(openChild?.status).toBe("todo");

      // AS-264's completion count, computed from the SAME data this
      // action returned — not a separate hand-counted assumption.
      const { countSubtaskProgress } = await import(
        "@/lib/tasks/subtask-progress"
      );
      const progress = countSubtaskProgress(result.data.task.children ?? []);
      expect(progress.done).toBe(1);
      expect(progress.total).toBe(2);
    });

    it("test_AS_264_a_newly_added_subtask_appears_in_the_very_next_task_detail_fetch", async () => {
      const parentId = await makeTask("F150 AS264 LiveAdd Parent");

      const { getTaskDetail } = await import("@/lib/actions/tasks");

      const before = await getTaskDetail(parentId);
      expect(before.ok).toBe(true);
      if (!before.ok) return;
      expect(before.data.task.children).toHaveLength(0);

      const childId = await makeTask("F150 AS264 LiveAdd Child", "todo", parentId);

      const after = await getTaskDetail(parentId);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.data.task.children?.map((c) => c.id)).toContain(childId);
    });

    it("test_AS_264_a_promoted_subtask_no_longer_appears_in_its_former_parents_children", async () => {
      const parentId = await makeTask("F150 AS264 Promote Parent");
      const childId = await makeTask("F150 AS264 Promote Child", "todo", parentId);

      const { getTaskDetail, promoteSubtask } = await import(
        "@/lib/actions/tasks"
      );

      const before = await getTaskDetail(parentId);
      expect(before.ok).toBe(true);
      if (before.ok) {
        expect(before.data.task.children?.map((c) => c.id)).toContain(
          childId,
        );
      }

      const promoted = await promoteSubtask(childId);
      expect(promoted.ok).toBe(true);

      const after = await getTaskDetail(parentId);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.data.task.children?.map((c) => c.id)).not.toContain(
        childId,
      );
    });

    it("test_AS_275_a_child_task_still_appears_as_its_own_ordinary_row_on_the_board_query", async () => {
      const parentId = await makeTask("F150 AS275 Parent");
      const childId = await makeTask("F150 AS275 Child", "todo", parentId);

      // getProjectBoardTasks (lib/queries/tasks.ts) uses the plain,
      // RLS-backed server client — the same signed-in member session
      // this file's createClient() mock resolves to. RLS itself
      // (tasks_select_active_members) independently allows this member
      // to read both rows; the point under test is that this feature's
      // OWN change (the added subtaskCount aggregate) didn't also narrow
      // the main row-selecting query.
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const boardTasks = await getProjectBoardTasks(projectId);

      const parentRow = boardTasks.find((t) => t.id === parentId);
      const childRow = boardTasks.find((t) => t.id === childId);

      // The child is present as its OWN row — not merged into, replaced
      // by, or hidden inside the parent's row.
      expect(childRow).toBeDefined();
      expect(childRow?.id).not.toBe(parentRow?.id);
      expect(childRow?.title).toContain("F150 AS275 Child");

      // The parent's row carries the new subtaskCount indicator, proving
      // the aggregate query is wired up and correct.
      expect(parentRow?.subtaskCount).toBe(1);
      // A leaf child (which per F148 can never itself have children) has
      // no subtaskCount at all — undefined, not 0, matching
      // TaskCardTask.subtaskCount's own "undefined/0 both hide the
      // indicator" contract.
      expect(childRow?.subtaskCount).toBeUndefined();
    });

    it("test_AS_275_a_task_with_multiple_children_reports_the_correct_count", async () => {
      const parentId = await makeTask("F150 AS275 MultiParent");
      await makeTask("F150 AS275 MultiChild1", "todo", parentId);
      await makeTask("F150 AS275 MultiChild2", "in_progress", parentId);
      await makeTask("F150 AS275 MultiChild3", "done", parentId);

      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const boardTasks = await getProjectBoardTasks(projectId);

      const parentRow = boardTasks.find((t) => t.id === parentId);
      expect(parentRow?.subtaskCount).toBe(3);

      // All 3 children are STILL present as their own separate board
      // rows alongside the parent (AS-275) — 4 rows total for this
      // parent+children group, not 1.
      const groupTitles = boardTasks
        .filter((t) => t.title.includes("F150 AS275 Multi"))
        .map((t) => t.title);
      expect(groupTitles).toHaveLength(4);
    });
  },
);
