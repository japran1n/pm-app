// Integration test for F237 timeline query (AS-451, AS-452) -- run
// against the real linked Supabase project, mirrors the loadDotEnv/
// real-signed-in-client/beforeAll-seed/afterAll-teardown pattern
// established by tests/integration/f232-calendar-query.test.ts.
//
// Drives the REAL query path (getTimelineTasks, lib/queries/timeline.ts)
// through the plain RLS-scoped session client -- the exact layer F322/
// F323's bug class slipped through when it wasn't exercised.

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
    "F237: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveAdminCreds)("F237 getTimelineTasks (AS-451, AS-452)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  let visibleProjectId: string;
  let privateProjectId: string;
  let archivedProjectId: string;

  let memberEmail: string;
  const memberPassword = "Test-password-1!";
  let memberUserId: string;
  let otherMemberUserId: string;

  let rangeBarTaskId: string;
  let markerNoDueTaskId: string;
  let markerNoStartTaskId: string;
  let neitherDateTaskId: string;
  let privateProjectTaskId: string;
  let archivedProjectTaskId: string;
  let trashedTaskId: string;

  const RANGE_START = "2026-06-01";
  const RANGE_END = "2026-06-30";

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
      .insert({ name: "F237 Workspace", slug: `f237-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f237-member-${uniqueSuffix}@example.com`;
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
        email: `f237-other-${uniqueSuffix}@example.com`,
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

    const { data: visibleProject, error: visibleErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F237 Visible Project", visibility: "workspace" })
      .select("id")
      .single();
    if (visibleErr || !visibleProject) {
      throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
    }
    visibleProjectId = visibleProject.id;
    createdProjectIds.push(visibleProjectId);

    const { data: privateProject, error: privateErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F237 Private Project", visibility: "private" })
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

    const { data: archivedProject, error: archivedErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F237 Archived Project", visibility: "workspace" })
      .select("id")
      .single();
    if (archivedErr || !archivedProject) {
      throw new Error(`Failed to seed archived project: ${archivedErr?.message}`);
    }
    archivedProjectId = archivedProject.id;
    createdProjectIds.push(archivedProjectId);

    // AS-451: a task with BOTH start_date and due_date -- the real "range
    // bar" case.
    const { data: rangeTask, error: rangeTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F237 range-bar task",
        status: "todo",
        priority: "high",
        author_id: memberUserId,
        start_date: "2026-06-05",
        due_date: "2026-06-10",
        number: 1,
      })
      .select("id")
      .single();
    if (rangeTaskErr || !rangeTask) {
      throw new Error(`Failed to seed range-bar task: ${rangeTaskErr?.message}`);
    }
    rangeBarTaskId = rangeTask.id;

    // AS-452: a task with due_date but NO start_date -- single-day
    // marker on its due date.
    const { data: markerNoDue, error: markerNoDueErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F237 marker-no-start task",
        status: "todo",
        priority: "medium",
        author_id: memberUserId,
        due_date: "2026-06-15",
        number: 2,
      })
      .select("id")
      .single();
    if (markerNoDueErr || !markerNoDue) {
      throw new Error(`Failed to seed marker-no-start task: ${markerNoDueErr?.message}`);
    }
    markerNoDueTaskId = markerNoDue.id;

    // Symmetric case: start_date but NO due_date -- single-day marker on
    // its start date.
    const { data: markerNoStart, error: markerNoStartErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F237 marker-no-due task",
        status: "todo",
        priority: "low",
        author_id: memberUserId,
        start_date: "2026-06-20",
        number: 3,
      })
      .select("id")
      .single();
    if (markerNoStartErr || !markerNoStart) {
      throw new Error(`Failed to seed marker-no-due task: ${markerNoStartErr?.message}`);
    }
    markerNoStartTaskId = markerNoStart.id;

    // Neither date -- must never appear on the timeline.
    const { data: neitherDate, error: neitherDateErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F237 no-date task",
        status: "todo",
        priority: "backlog",
        author_id: memberUserId,
        number: 4,
      })
      .select("id")
      .single();
    if (neitherDateErr || !neitherDate) {
      throw new Error(`Failed to seed no-date task: ${neitherDateErr?.message}`);
    }
    neitherDateTaskId = neitherDate.id;

    // Task in the PRIVATE project, due inside the range -- must not
    // appear for a member who cannot see that project.
    const { data: privateTask, error: privateTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: privateProjectId,
        title: "F237 private task",
        status: "todo",
        priority: "urgent",
        author_id: otherMemberUserId,
        due_date: "2026-06-15",
        number: 1,
      })
      .select("id")
      .single();
    if (privateTaskErr || !privateTask) {
      throw new Error(`Failed to seed private task: ${privateTaskErr?.message}`);
    }
    privateProjectTaskId = privateTask.id;

    // Task in an ARCHIVED project -- must be excluded.
    const { data: archivedTask, error: archivedTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: archivedProjectId,
        title: "F237 archived-project task",
        status: "todo",
        priority: "low",
        author_id: memberUserId,
        due_date: "2026-06-15",
        number: 1,
      })
      .select("id")
      .single();
    if (archivedTaskErr || !archivedTask) {
      throw new Error(`Failed to seed archived-project task: ${archivedTaskErr?.message}`);
    }
    archivedProjectTaskId = archivedTask.id;
    const { error: archiveErr } = await adminClient
      .from("projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", archivedProjectId);
    if (archiveErr) throw new Error(archiveErr.message);

    // TRASHED task in the visible project -- must be excluded.
    const { data: trashedTask, error: trashedTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F237 trashed task",
        status: "todo",
        priority: "low",
        author_id: memberUserId,
        due_date: "2026-06-15",
        number: 5,
      })
      .select("id")
      .single();
    if (trashedTaskErr || !trashedTask) {
      throw new Error(`Failed to seed trashed task: ${trashedTaskErr?.message}`);
    }
    trashedTaskId = trashedTask.id;
    const { error: trashErr } = await adminClient
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", trashedTaskId);
    if (trashErr) throw new Error(trashErr.message);

    await signInAs(memberEmail, memberPassword);
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
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

  it("test_AS_451_a_real_tasks_bar_starts_and_ends_on_the_right_dates_through_the_real_query_path", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const row = tasks.find((t) => t.id === rangeBarTaskId);
    expect(row).toBeDefined();
    expect(row?.startDate).toBe("2026-06-05");
    expect(row?.dueDate).toBe("2026-06-10");
  });

  it("test_AS_452_a_task_without_a_start_date_comes_back_with_startDate_null_and_its_real_due_date", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const row = tasks.find((t) => t.id === markerNoDueTaskId);
    expect(row).toBeDefined();
    expect(row?.startDate).toBeNull();
    expect(row?.dueDate).toBe("2026-06-15");
  });

  it("test_AS_452_a_task_without_a_due_date_comes_back_with_dueDate_null_and_its_real_start_date", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const row = tasks.find((t) => t.id === markerNoStartTaskId);
    expect(row).toBeDefined();
    expect(row?.dueDate).toBeNull();
    expect(row?.startDate).toBe("2026-06-20");
  });

  it("test_AS_452_negative_a_task_with_neither_date_is_excluded_from_the_query_result", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(neitherDateTaskId);
  });

  it("test_AS_452_the_neither_date_task_is_counted_by_getUndatedTimelineTaskCount", async () => {
    const { getUndatedTimelineTaskCount } = await import("@/lib/queries/timeline");
    const count = await getUndatedTimelineTaskCount(workspaceId, visibleProjectId);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("test_AS_451_negative_a_private_project_the_viewer_cannot_see_contributes_nothing_to_the_timeline", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(privateProjectTaskId);
  });

  it("test_AS_451_negative_an_archived_projects_tasks_are_excluded", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(archivedProjectTaskId);
  });

  it("test_AS_451_negative_a_trashed_task_is_excluded", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(trashedTaskId);
  });

  it("test_AS_451_project_filter_narrows_to_a_single_project", async () => {
    const { getTimelineTasks } = await import("@/lib/queries/timeline");
    const tasks = await getTimelineTasks(workspaceId, RANGE_START, RANGE_END, {
      projectId: visibleProjectId,
    });
    expect(tasks.every((t) => t.projectId === visibleProjectId)).toBe(true);
    expect(tasks.some((t) => t.id === rangeBarTaskId)).toBe(true);
  });
});
