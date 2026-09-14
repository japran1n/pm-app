// Integration test for F225 swimlane-drag-reassign (AS-420, AS-425), run
// against the real linked Supabase project — mirrors the loadDotEnv/
// admin-client/mocked-`@/lib/supabase/server`-auth/beforeAll-seed/
// afterAll-teardown pattern established by
// tests/integration/f322-single-task-project-visibility.test.ts (`@/lib/
// supabase/server`'s `createClient()` is mocked to stand in for the
// caller's authenticated session — Server Actions call Next's `cookies()`,
// which only works inside a real request, not a Vitest process — while
// every DB write/read in this file goes through the REAL Supabase
// project's `SUPABASE_SECRET_KEY` admin client).
//
// Exercises the REAL Server Actions board.tsx's handleDragEnd calls on a
// cross-lane drop (lib/actions/tasks.ts's setTaskAssignees, updateTaskTags,
// editTask, and moveAndReorderTask/reorderTask for the status/position
// half) against the real database — never a hand-built fixture, never a
// direct table write from the test itself for anything the action layer
// is supposed to own. Each grouping mode's "move" semantics (this
// feature's AUTONOMOUS_DECISION, recorded in board.tsx's own doc comment
// on `groupFieldPatch`) is reproduced here exactly as board.tsx computes
// it, then verified against the real `task_assignees`/`tasks.tags`/
// `tasks.priority` rows afterward.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedLegacyStatusColumns } from "../helpers/legacy-status-columns";

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
    "F225: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

// Same stand-in as f322's — `@/lib/actions/tasks` calls this real module's
// `createClient()` for the caller's own session (`auth.getUser()`), which
// every action re-checks membership/visibility against server-side. The
// mocked `supabase` client returned to `setTaskAssigneesCore` is also used
// for `createNotification`'s SECURITY DEFINER call — its `auth.uid()`
// would be null under this mock, so notification fan-out is expected to
// no-op/log non-fatally here, exactly as it already does for any
// unauthenticated edge case per that function's own doc comment.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentTestUserId ? { id: currentTestUserId } : null },
      }),
    },
    from: () => ({
      insert: async () => ({ data: null, error: null }),
    }),
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "F225 swimlane-drag-reassign (AS-420, AS-425)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;

    let memberUserId: string;
    let otherMemberUserId: string;
    let viewerUserId: string;

    async function makeTask(
      overrides: Partial<{ priority: string | null; tags: string[]; status: string }>,
    ) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F225 task ${Math.random().toString(36).slice(2, 8)}`,
          status: overrides.status ?? "todo",
          position: 1000,
          author_id: memberUserId,
          priority: overrides.priority ?? null,
          tags: overrides.tags ?? [],
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Failed to create task: ${error?.message}`);
      return data.id as string;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F225 Workspace", slug: `f225-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
        email: `f225-member-${uniqueSuffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (userErr || !userData.user) {
        throw new Error(`Failed to create member user: ${userErr?.message}`);
      }
      memberUserId = userData.user.id;
      createdUserIds.push(memberUserId);

      const { data: otherUserData, error: otherUserErr } =
        await adminClient.auth.admin.createUser({
          email: `f225-member2-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (otherUserErr || !otherUserData.user) {
        throw new Error(`Failed to create second member user: ${otherUserErr?.message}`);
      }
      otherMemberUserId = otherUserData.user.id;
      createdUserIds.push(otherMemberUserId);

      const { data: viewerData, error: viewerErr } = await adminClient.auth.admin.createUser({
        email: `f225-viewer-${uniqueSuffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (viewerErr || !viewerData.user) {
        throw new Error(`Failed to create viewer user: ${viewerErr?.message}`);
      }
      viewerUserId = viewerData.user.id;
      createdUserIds.push(viewerUserId);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F225 Project ${uniqueSuffix}`,
          created_by: memberUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // status_set_v2: this suite uses the legacy names literally, so
      // seed them as project-owned columns (pattern A).
      await seedLegacyStatusColumns(adminClient, projectId);
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("test_AS_420_priority_cross_lane_drag_moves_through_the_real_editTask_action", async () => {
      const taskId = await makeTask({ priority: "low" });
      currentTestUserId = memberUserId;

      // Reproduce board.tsx's groupBy === "priority" groupFieldPatch
      // exactly: the target lane key IS the new priority value.
      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { priority: "urgent" });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("priority")
        .eq("id", taskId)
        .single();
      expect(row?.priority).toBe("urgent");
    });

    it("test_AS_420_priority_drag_into_None_lane_clears_priority_through_the_real_action", async () => {
      const taskId = await makeTask({ priority: "high" });
      currentTestUserId = memberUserId;

      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { priority: null });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("priority")
        .eq("id", taskId)
        .single();
      expect(row?.priority).toBeNull();
    });

    it("test_AS_420_assignee_cross_lane_drag_moves_the_dragged_assignee_via_the_real_setTaskAssignees_action", async () => {
      const taskId = await makeTask({});
      // Seed: assigned to BOTH memberUserId and otherMemberUserId, so this
      // task renders in both lanes (F224's multi-lane rule) before the
      // drag.
      await adminClient
        .from("task_assignees")
        .insert([
          { task_id: taskId, user_id: memberUserId },
          { task_id: taskId, user_id: otherMemberUserId },
        ]);

      currentTestUserId = memberUserId;
      const { setTaskAssignees } = await import("@/lib/actions/tasks");

      // Drag from memberUserId's lane to a third lane (a lane the task
      // wasn't already in) — board.tsx's "move" semantics: remove the
      // source lane's id, add the target's, leave every other assignee
      // untouched.
      const current = [memberUserId, otherMemberUserId];
      const sourceLaneKey = memberUserId;
      const targetLaneKey = viewerUserId; // a workspace member not yet assigned
      const next = current.filter((id) => id !== sourceLaneKey);
      next.push(targetLaneKey);

      const result = await setTaskAssignees(taskId, next);
      expect(result.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      const ids = (rows ?? []).map((r) => r.user_id as string).sort();
      // The dragged-out assignee (memberUserId) is gone; the untouched
      // assignee (otherMemberUserId) is still there; the target
      // (viewerUserId) was added.
      expect(ids).toEqual([otherMemberUserId, viewerUserId].sort());
    });

    it("test_AS_420_assignee_drag_out_of_None_lane_adds_without_needing_a_removal", async () => {
      const taskId = await makeTask({}); // no assignees -- starts in "None"
      currentTestUserId = memberUserId;
      const { setTaskAssignees } = await import("@/lib/actions/tasks");

      // sourceLaneKey === SWIMLANE_NONE_KEY -> current.filter(id !== that
      // sentinel) is a no-op; targetLaneKey is added.
      const result = await setTaskAssignees(taskId, [memberUserId]);
      expect(result.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      expect((rows ?? []).map((r) => r.user_id)).toEqual([memberUserId]);
    });

    it("test_AS_420_assignee_drag_into_None_lane_removes_without_adding_a_replacement", async () => {
      const taskId = await makeTask({});
      await adminClient.from("task_assignees").insert({ task_id: taskId, user_id: memberUserId });
      currentTestUserId = memberUserId;
      const { setTaskAssignees } = await import("@/lib/actions/tasks");

      // targetLaneKey === SWIMLANE_NONE_KEY -> nothing added.
      const result = await setTaskAssignees(taskId, []);
      expect(result.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      expect(rows ?? []).toHaveLength(0);
    });

    it("test_AS_420_tag_cross_lane_drag_moves_the_dragged_tag_via_the_real_updateTaskTags_action", async () => {
      const taskId = await makeTask({ tags: ["bug", "urgent-fix"] });
      currentTestUserId = memberUserId;
      const { updateTaskTags } = await import("@/lib/actions/tasks");

      // Drag from the "bug" lane to a new "triaged" lane.
      const current = ["bug", "urgent-fix"];
      const next = current.filter((t) => t !== "bug");
      next.push("triaged");

      const result = await updateTaskTags(taskId, next);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect((row?.tags as string[]).slice().sort()).toEqual(
        ["triaged", "urgent-fix"].sort(),
      );
    });

    it("test_AS_425_within_column_reorder_persists_position_alone_while_grouped", async () => {
      // AS-425: ordering within a column still works while grouped -- the
      // grouped field is untouched by a same-lane, same-column reorder;
      // only `position` changes, through the same reorderTask a same-
      // column ungrouped drag already used (board.tsx's `crossLane` is
      // false here since source/target lane keys are equal).
      const taskId = await makeTask({ priority: "medium" });
      currentTestUserId = memberUserId;
      const { reorderTask } = await import("@/lib/actions/tasks");

      const result = await reorderTask(taskId, 2500);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("position, priority")
        .eq("id", taskId)
        .single();
      expect(row?.position).toBe(2500);
      // The grouped field (priority) is untouched by a pure reorder.
      expect(row?.priority).toBe("medium");
    });

    it("test_AS_420_cross_lane_AND_cross_column_drag_persists_both_status_position_and_the_grouped_field", async () => {
      const taskId = await makeTask({ priority: "low", status: "todo" });
      currentTestUserId = memberUserId;
      const { moveAndReorderTask, editTask } = await import("@/lib/actions/tasks");

      const [statusResult, fieldResult] = await Promise.all([
        moveAndReorderTask(taskId, "in_progress", 3000),
        editTask(taskId, { priority: "urgent" }),
      ]);
      expect(statusResult.ok).toBe(true);
      expect(fieldResult.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("status, position, priority")
        .eq("id", taskId)
        .single();
      expect(row?.status).toBe("in_progress");
      expect(row?.position).toBe(3000);
      expect(row?.priority).toBe("urgent");
    });

    it("test_AS_420_viewer_role_is_rejected_by_the_real_action_not_just_hidden_UI_assignee", async () => {
      const taskId = await makeTask({});
      await adminClient.from("task_assignees").insert({ task_id: taskId, user_id: memberUserId });
      currentTestUserId = viewerUserId;
      const { setTaskAssignees } = await import("@/lib/actions/tasks");

      const result = await setTaskAssignees(taskId, [otherMemberUserId]);
      expect(result.ok).toBe(false);

      // DB state genuinely unchanged.
      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      expect((rows ?? []).map((r) => r.user_id)).toEqual([memberUserId]);
    });

    it("test_AS_420_viewer_role_is_rejected_by_the_real_action_not_just_hidden_UI_tag", async () => {
      const taskId = await makeTask({ tags: ["bug"] });
      currentTestUserId = viewerUserId;
      const { updateTaskTags } = await import("@/lib/actions/tasks");

      const result = await updateTaskTags(taskId, ["triaged"]);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient.from("tasks").select("tags").eq("id", taskId).single();
      expect(row?.tags).toEqual(["bug"]);
    });

    it("test_AS_420_viewer_role_is_rejected_by_the_real_action_not_just_hidden_UI_priority", async () => {
      const taskId = await makeTask({ priority: "low" });
      currentTestUserId = viewerUserId;
      const { editTask } = await import("@/lib/actions/tasks");

      const result = await editTask(taskId, { priority: "urgent" });
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("priority")
        .eq("id", taskId)
        .single();
      expect(row?.priority).toBe("low");
    });
  },
);
