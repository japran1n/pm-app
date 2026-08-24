// Integration test for F238 timeline-drag-resize (AS-454), run against
// the real linked Supabase project -- mirrors the loadDotEnv/admin-client/
// mocked-`@/lib/supabase/server`-auth/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f234-calendar-drag-reschedule.test.ts.
//
// Exercises the REAL Server Action components/timeline/timeline-body.tsx's
// handleDragEnd calls on a drag end -- `editTask` (lib/actions/tasks.ts) --
// against the real database, never a hand-built fixture and never a
// direct start_date/due_date write from the test itself. lib/timeline/
// reschedule.ts's pure planning functions are exercised here to derive
// the exact payload the real component would send, then that payload is
// handed to the real editTask action, proving the REAL end-to-end path
// (pure plan -> real Server Action -> real DB row), not merely the pure
// maths in isolation.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { planTimelineBarMove, planTimelineBarResize } from "@/lib/timeline/reschedule";

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
    "F238: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
        data: { user: currentTestUserId ? { id: currentTestUserId } : null },
      }),
    },
  }),
}));

describe.skipIf(!haveAdminCreds)("F238 timeline drag/resize (AS-454)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  let visibleProjectId: string;
  let privateProjectId: string;

  let memberUserId: string;
  let otherMemberUserId: string;

  async function makeTask(
    projectId: string,
    dates: { startDate?: string | null; dueDate?: string | null },
    authorId: string,
  ) {
    const { data, error } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: `F238 task ${Math.random().toString(36).slice(2, 8)}`,
        status: "todo",
        position: 1000,
        author_id: authorId,
        start_date: dates.startDate ?? null,
        due_date: dates.dueDate ?? null,
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
      .insert({ name: "F238 Workspace", slug: `f238-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const { data: memberAuth, error: memberErr } = await adminClient.auth.admin.createUser({
      email: `f238-member-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (memberErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    const { data: otherAuth, error: otherErr } = await adminClient.auth.admin.createUser({
      email: `f238-other-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (otherErr || !otherAuth.user) {
      throw new Error(`Failed to create second member user: ${otherErr?.message}`);
    }
    otherMemberUserId = otherAuth.user.id;
    createdUserIds.push(otherMemberUserId);

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
    ]);
    if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

    const { data: visibleProject, error: visibleErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F238 Visible Project", visibility: "workspace" })
      .select("id")
      .single();
    if (visibleErr || !visibleProject) {
      throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
    }
    visibleProjectId = visibleProject.id;
    createdProjectIds.push(visibleProjectId);

    // Permission-varies-per-project scenario, same shape F234's own
    // regression test uses: `memberUserId` can edit tasks in
    // `visibleProjectId` but not in `privateProjectId`.
    const { data: privateProject, error: privateErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F238 Private Project", visibility: "private" })
      .select("id")
      .single();
    if (privateErr || !privateProject) {
      throw new Error(`Failed to seed private project: ${privateErr?.message}`);
    }
    privateProjectId = privateProject.id;
    createdProjectIds.push(privateProjectId);
    await adminClient.from("project_members").insert({
      project_id: privateProjectId,
      user_id: otherMemberUserId,
    });
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await adminClient.from("tasks").delete().eq("project_id", id);
      await adminClient.from("project_members").delete().eq("project_id", id);
      await adminClient.from("projects").delete().eq("id", id);
    }
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_454_a_whole_bar_drag_changes_both_dates_and_preserves_duration_on_the_real_row", async () => {
    const taskId = await makeTask(
      visibleProjectId,
      { startDate: "2026-06-10", dueDate: "2026-06-14" },
      memberUserId,
    );
    currentTestUserId = memberUserId;

    // 3-day rightward drag, exactly the plan components/timeline/
    // timeline-body.tsx's handleDragEnd would compute from a dnd-kit
    // MOVE_PREFIX drag end.
    const plan = planTimelineBarMove(
      { id: taskId, startDate: "2026-06-10", dueDate: "2026-06-14" },
      3,
    );
    expect(plan).toEqual({ startDate: "2026-06-13", dueDate: "2026-06-17" });

    const { editTask } = await import("@/lib/actions/tasks");
    const result = await editTask(taskId, plan!);
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("tasks")
      .select("start_date, due_date")
      .eq("id", taskId)
      .single();
    expect(row?.start_date).toBe("2026-06-13");
    expect(row?.due_date).toBe("2026-06-17");
    // Duration (in whole days) is preserved by the move.
    expect(row?.due_date).not.toBe(row?.start_date);
  });

  it("test_AS_454_an_edge_resize_changes_only_the_intended_date_on_the_real_row", async () => {
    const taskId = await makeTask(
      visibleProjectId,
      { startDate: "2026-07-01", dueDate: "2026-07-10" },
      memberUserId,
    );
    currentTestUserId = memberUserId;

    // Drag the END handle 2 days later -- only due_date should change.
    const plan = planTimelineBarResize(
      { id: taskId, startDate: "2026-07-01", dueDate: "2026-07-10" },
      "end",
      2,
    );
    expect(plan).toEqual({ startDate: "2026-07-01", dueDate: "2026-07-12" });

    const { editTask } = await import("@/lib/actions/tasks");
    const result = await editTask(taskId, plan!);
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("tasks")
      .select("start_date, due_date")
      .eq("id", taskId)
      .single();
    expect(row?.start_date).toBe("2026-07-01"); // unchanged
    expect(row?.due_date).toBe("2026-07-12");
  });

  it("test_AS_454_off_by_one_guard_the_persisted_dates_are_exactly_the_planned_YYYY_MM_DD_regardless_of_ambient_timezone", async () => {
    // Month-end boundary, the highest-risk case for a
    // `new Date(dateOnlyString)` round trip to roll a day backward in a
    // zone west of UTC.
    const taskId = await makeTask(
      visibleProjectId,
      { startDate: "2026-01-30", dueDate: "2026-01-31" },
      memberUserId,
    );
    currentTestUserId = memberUserId;

    const plan = planTimelineBarMove(
      { id: taskId, startDate: "2026-01-30", dueDate: "2026-01-31" },
      1,
    );
    expect(plan).toEqual({ startDate: "2026-01-31", dueDate: "2026-02-01" });

    const { editTask } = await import("@/lib/actions/tasks");
    const result = await editTask(taskId, plan!);
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("tasks")
      .select("start_date, due_date")
      .eq("id", taskId)
      .single();
    expect(row?.start_date).toBe("2026-01-31");
    expect(row?.due_date).toBe("2026-02-01");
  });

  it("test_AS_454_a_resize_that_would_invert_the_bar_clamps_instead_of_producing_a_db_check_violation", async () => {
    const taskId = await makeTask(
      visibleProjectId,
      { startDate: "2026-08-05", dueDate: "2026-08-10" },
      memberUserId,
    );
    currentTestUserId = memberUserId;

    // Drag the START handle 20 days forward -- far past the due date.
    // The pure planner clamps to the due date rather than proposing an
    // inverted pair, so editTask never even attempts a write the
    // tasks_start_date_not_after_due_date CHECK would reject.
    const plan = planTimelineBarResize(
      { id: taskId, startDate: "2026-08-05", dueDate: "2026-08-10" },
      "start",
      20,
    );
    expect(plan).toEqual({ startDate: "2026-08-10", dueDate: "2026-08-10" });

    const { editTask } = await import("@/lib/actions/tasks");
    const result = await editTask(taskId, plan!);
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("tasks")
      .select("start_date, due_date")
      .eq("id", taskId)
      .single();
    expect(row?.start_date).toBe("2026-08-10");
    expect(row?.due_date).toBe("2026-08-10");
  });

  it("test_AS_454_negative_a_user_without_permission_on_the_tasks_project_is_rejected_by_the_action_with_db_state_unchanged", async () => {
    const taskId = await makeTask(
      privateProjectId,
      { startDate: "2026-06-10", dueDate: "2026-06-14" },
      otherMemberUserId,
    );
    // memberUserId is an active workspace member but has no
    // project_members row for privateProjectId and the project is
    // 'private' -- isProjectVisibleToCaller (reused, unmodified, from
    // editTask's own F322/F323-fixed check) must reject this.
    currentTestUserId = memberUserId;

    const plan = planTimelineBarMove(
      { id: taskId, startDate: "2026-06-10", dueDate: "2026-06-14" },
      3,
    );

    const { editTask } = await import("@/lib/actions/tasks");
    const result = await editTask(taskId, plan!);
    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("tasks")
      .select("start_date, due_date")
      .eq("id", taskId)
      .single();
    // DB state unchanged.
    expect(row?.start_date).toBe("2026-06-10");
    expect(row?.due_date).toBe("2026-06-14");
  });

  it("test_AS_454_a_marker_task_with_only_a_due_date_drags_its_one_date_and_leaves_start_date_null", async () => {
    const taskId = await makeTask(visibleProjectId, { startDate: null, dueDate: "2026-09-05" }, memberUserId);
    currentTestUserId = memberUserId;

    const plan = planTimelineBarMove({ id: taskId, startDate: null, dueDate: "2026-09-05" }, 4);
    expect(plan).toEqual({ startDate: null, dueDate: "2026-09-09" });

    const { editTask } = await import("@/lib/actions/tasks");
    const result = await editTask(taskId, plan!);
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("tasks")
      .select("start_date, due_date")
      .eq("id", taskId)
      .single();
    expect(row?.start_date).toBeNull();
    expect(row?.due_date).toBe("2026-09-09");
  });
});
