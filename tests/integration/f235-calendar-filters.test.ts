// Integration test for F235 calendar filters (AS-448) -- run against the
// real linked Supabase project, mirrors the loadDotEnv/real-signed-in-
// client/beforeAll-seed/afterAll-teardown pattern established by
// tests/integration/f232-calendar-query.test.ts (this feature's own
// dependency).
//
// Drives the REAL query path (getCalendarTasks, lib/queries/calendar.ts,
// with its `filters` argument) through the plain RLS-scoped session
// client -- proves each filter narrows the REAL query result, not a
// client-side filter over a full fetch, and that a private project the
// viewer cannot see contributes nothing under every filter combination.

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
    "F235: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)("F235 getCalendarTasks filters (AS-448)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  let projectAId: string; // default columns ("todo", "in_progress", ...)
  let projectBId: string; // one column renamed to a custom name
  let privateProjectId: string;

  let memberEmail: string;
  const memberPassword = "Test-password-1!";
  let memberUserId: string;
  let otherMemberUserId: string;

  let taskTodoAId: string; // project A, status "todo", assigned to member
  let taskDoneBId: string; // project B, status "done" -> renamed "Shipped"
  let taskHighPriorityId: string;
  let privateProjectTaskId: string;

  const RANGE_START = "2026-07-01";
  const RANGE_END = "2026-07-31";

  async function signInAs(email: string, password: string) {
    const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(`Failed to sign in ${email}: ${error.message}`);
    }
    currentTestClient = client as unknown as typeof currentTestClient;
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F235 Workspace", slug: `f235-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f235-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: memberPassword,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    const { data: otherAuth, error: otherAuthErr } =
      await adminClient.auth.admin.createUser({
        email: `f235-other-${uniqueSuffix}@example.com`,
        password: memberPassword,
        email_confirm: true,
      });
    if (otherAuthErr || !otherAuth.user) {
      throw new Error(`Failed to create other member: ${otherAuthErr?.message}`);
    }
    otherMemberUserId = otherAuth.user.id;
    createdUserIds.push(otherMemberUserId);

    const { error: memberRowErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
    ]);
    if (memberRowErr) throw new Error(`Failed to seed membership: ${memberRowErr.message}`);

    const { data: projectA, error: projectAErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F235 Project A", visibility: "workspace" })
      .select("id")
      .single();
    if (projectAErr || !projectA) {
      throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
    }
    projectAId = projectA.id;
    createdProjectIds.push(projectAId);

    const { data: projectB, error: projectBErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F235 Project B", visibility: "workspace" })
      .select("id")
      .single();
    if (projectBErr || !projectB) {
      throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
    }
    projectBId = projectB.id;
    createdProjectIds.push(projectBId);

    const { data: privateProject, error: privateErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F235 Private Project", visibility: "private" })
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

    // Project B: DIFFERENT column set -- its "done" column is renamed to
    // "Shipped" (F218-F223's own per-project rename), the exact
    // cross-project scenario AS-448's status filter has to handle without
    // assuming a fixed four values.
    const { error: renameErr } = await adminClient
      .from("project_statuses")
      .update({ name: "Shipped" })
      .eq("project_id", projectBId)
      .eq("name", "done");
    if (renameErr) throw new Error(`Failed to rename project B's done column: ${renameErr.message}`);

    // Task A: project A, status "todo", assigned to the signed-in member.
    const { data: taskTodoA, error: taskTodoAErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectAId,
        title: "F235 project A todo task",
        status: "todo",
        priority: "medium",
        author_id: memberUserId,
        due_date: "2026-07-10",
        number: 1,
      })
      .select("id")
      .single();
    if (taskTodoAErr || !taskTodoA) {
      throw new Error(`Failed to seed task A: ${taskTodoAErr?.message}`);
    }
    taskTodoAId = taskTodoA.id;
    await adminClient
      .from("task_assignees")
      .insert({ task_id: taskTodoAId, user_id: memberUserId });

    // Task B: project B, status "done" -- kept in sync by
    // sync_task_status_and_status_id to the renamed column's real name
    // ("Shipped"), NOT category, once its status_id resolves.
    const { data: taskDoneB, error: taskDoneBErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectBId,
        title: "F235 project B shipped task",
        status: "Shipped",
        priority: "low",
        author_id: memberUserId,
        due_date: "2026-07-12",
        number: 1,
      })
      .select("id")
      .single();
    if (taskDoneBErr || !taskDoneB) {
      throw new Error(`Failed to seed task B: ${taskDoneBErr?.message}`);
    }
    taskDoneBId = taskDoneB.id;

    // Task with a distinct priority, no assignee -- for the priority filter.
    const { data: highTask, error: highTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectAId,
        title: "F235 high priority task",
        status: "in_progress",
        priority: "urgent",
        author_id: memberUserId,
        due_date: "2026-07-15",
        number: 2,
      })
      .select("id")
      .single();
    if (highTaskErr || !highTask) {
      throw new Error(`Failed to seed high-priority task: ${highTaskErr?.message}`);
    }
    taskHighPriorityId = highTask.id;

    // Task in the PRIVATE project, due inside the range, assigned to the
    // signed-in member too -- must never appear, under ANY filter
    // combination, since the caller can't see the private project at all.
    const { data: privateTask, error: privateTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: privateProjectId,
        title: "F235 private task",
        status: "todo",
        priority: "urgent",
        author_id: otherMemberUserId,
        due_date: "2026-07-10",
        number: 1,
      })
      .select("id")
      .single();
    if (privateTaskErr || !privateTask) {
      throw new Error(`Failed to seed private task: ${privateTaskErr?.message}`);
    }
    privateProjectTaskId = privateTask.id;
    await adminClient
      .from("task_assignees")
      .insert({ task_id: privateProjectTaskId, user_id: memberUserId });

    await signInAs(memberEmail, memberPassword);
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await adminClient.from("task_assignees").delete().in(
        "task_id",
        [taskTodoAId, taskDoneBId, taskHighPriorityId, privateProjectTaskId].filter(Boolean),
      );
      await adminClient.from("tasks").delete().eq("project_id", id);
      await adminClient.from("project_statuses").delete().eq("project_id", id);
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

  it("test_AS_448_an_assignee_filter_narrows_the_real_query_to_only_that_assignees_tasks", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      assigneeId: memberUserId,
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(taskTodoAId);
    // The private task IS assigned to this member too, but must still
    // never appear -- private-project visibility wins over the filter.
    expect(ids).not.toContain(privateProjectTaskId);
  });

  it("test_AS_448_negative_an_assignee_filter_excludes_tasks_assigned_to_someone_else", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      assigneeId: memberUserId,
    });
    const ids = tasks.map((t) => t.id);
    // taskDoneB / taskHighPriority have no assignee at all -- unassigned
    // tasks never match a specific assignee filter.
    expect(ids).not.toContain(taskDoneBId);
    expect(ids).not.toContain(taskHighPriorityId);
  });

  it("test_AS_448_a_priority_filter_narrows_the_real_query_to_only_that_priority", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      priority: "urgent",
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(taskHighPriorityId);
    expect(ids).not.toContain(taskTodoAId);
    expect(ids).not.toContain(taskDoneBId);
  });

  it("test_AS_448_a_project_filter_narrows_the_real_query_to_only_that_project", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      projectId: projectBId,
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(taskDoneBId);
    expect(ids).not.toContain(taskTodoAId);
    expect(ids).not.toContain(taskHighPriorityId);
  });

  it("test_AS_448_cross_project_status_filter_matches_by_real_column_name_two_projects_with_different_column_sets", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");

    // Project A's default "todo" column vs. project B's RENAMED "Shipped"
    // column -- two different real names for two different projects'
    // status sets. Filtering by "todo" only ever matches project A's
    // task; filtering by "Shipped" only ever matches project B's task,
    // proving the filter is keyed on the column's real NAME across
    // projects (F223's precedent), not a shared fixed enum or category.
    const todoTasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      status: "todo",
    });
    expect(todoTasks.map((t) => t.id)).toContain(taskTodoAId);
    expect(todoTasks.map((t) => t.id)).not.toContain(taskDoneBId);

    const shippedTasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      status: "Shipped",
    });
    expect(shippedTasks.map((t) => t.id)).toContain(taskDoneBId);
    expect(shippedTasks.map((t) => t.id)).not.toContain(taskTodoAId);
  });

  it("test_AS_448_negative_a_private_project_the_viewer_cannot_see_contributes_nothing_under_every_filter_combination", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");

    const byAssignee = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      assigneeId: memberUserId,
    });
    const byStatus = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      status: "todo",
    });
    const byPriority = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      priority: "urgent",
    });
    const combined = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      assigneeId: memberUserId,
      status: "todo",
      priority: "urgent",
    });

    for (const result of [byAssignee, byStatus, byPriority, combined]) {
      expect(result.map((t) => t.id)).not.toContain(privateProjectTaskId);
    }
  });

  it("test_AS_448_combined_filters_are_AND_ed_together", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END, {
      projectId: projectAId,
      priority: "urgent",
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(taskHighPriorityId);
    // taskTodoA is in project A but is priority "medium" -- must be
    // excluded once BOTH filters apply.
    expect(ids).not.toContain(taskTodoAId);
  });
});
