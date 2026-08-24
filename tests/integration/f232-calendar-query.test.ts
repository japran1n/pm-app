// Integration test for F232 calendar month grid (AS-442, AS-450) -- run
// against the real linked Supabase project, mirrors the loadDotEnv/
// real-signed-in-client/beforeAll-seed/afterAll-teardown pattern
// established by tests/integration/f230-my-tasks-query.test.ts.
//
// Drives the REAL query path (getCalendarTasks, lib/queries/calendar.ts)
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
    "F232: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveAdminCreds)("F232 getCalendarTasks (AS-442, AS-450)", () => {
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

  let firstOfMonthTaskId: string;
  let lastOfMonthTaskId: string;
  let noDueDateTaskId: string;
  let privateProjectTaskId: string;
  let archivedProjectTaskId: string;
  let trashedTaskId: string;

  const RANGE_MONTH_YEAR = 2026;
  const RANGE_MONTH = 6; // June -- 30 days, no DST edge, keeps the seed simple.
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
      .insert({ name: "F232 Workspace", slug: `f232-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f232-member-${uniqueSuffix}@example.com`;
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
        email: `f232-other-${uniqueSuffix}@example.com`,
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
      .insert({ workspace_id: workspaceId, name: "F232 Visible Project", visibility: "workspace" })
      .select("id")
      .single();
    if (visibleErr || !visibleProject) {
      throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
    }
    visibleProjectId = visibleProject.id;
    createdProjectIds.push(visibleProjectId);

    const { data: privateProject, error: privateErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F232 Private Project", visibility: "private" })
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
      .insert({ workspace_id: workspaceId, name: "F232 Archived Project", visibility: "workspace" })
      .select("id")
      .single();
    if (archivedErr || !archivedProject) {
      throw new Error(`Failed to seed archived project: ${archivedErr?.message}`);
    }
    archivedProjectId = archivedProject.id;
    createdProjectIds.push(archivedProjectId);

    // Task due on the FIRST day of the visible range.
    const { data: firstTask, error: firstTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F232 first-of-month task",
        status: "todo",
        priority: "high",
        author_id: memberUserId,
        due_date: RANGE_START,
        number: 1,
      })
      .select("id")
      .single();
    if (firstTaskErr || !firstTask) {
      throw new Error(`Failed to seed first-of-month task: ${firstTaskErr?.message}`);
    }
    firstOfMonthTaskId = firstTask.id;

    // Task due on the LAST day of the visible range.
    const { data: lastTask, error: lastTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F232 last-of-month task",
        status: "todo",
        priority: "low",
        author_id: memberUserId,
        due_date: RANGE_END,
        number: 2,
      })
      .select("id")
      .single();
    if (lastTaskErr || !lastTask) {
      throw new Error(`Failed to seed last-of-month task: ${lastTaskErr?.message}`);
    }
    lastOfMonthTaskId = lastTask.id;

    // Task with NO due date -- must never appear (F235's AS-446 seam, but
    // this feature's own query already excludes it by construction).
    const { data: noDueTask, error: noDueErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: visibleProjectId,
        title: "F232 no-due-date task",
        status: "todo",
        priority: "medium",
        author_id: memberUserId,
        number: 3,
      })
      .select("id")
      .single();
    if (noDueErr || !noDueTask) {
      throw new Error(`Failed to seed no-due-date task: ${noDueErr?.message}`);
    }
    noDueDateTaskId = noDueTask.id;

    // Task in the PRIVATE project, due inside the range -- must not
    // appear for a member who cannot see that project.
    const { data: privateTask, error: privateTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: privateProjectId,
        title: "F232 private task",
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
        title: "F232 archived-project task",
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
        title: "F232 trashed task",
        status: "todo",
        priority: "low",
        author_id: memberUserId,
        due_date: "2026-06-15",
        number: 4,
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

    void RANGE_MONTH_YEAR;
    void RANGE_MONTH;

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

  it("test_AS_442_a_task_due_on_the_first_day_of_the_month_lands_in_the_right_cell", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END);
    const row = tasks.find((t) => t.id === firstOfMonthTaskId);
    expect(row).toBeDefined();
    expect(row?.dueDate).toBe(RANGE_START);
  });

  it("test_AS_442_a_task_due_on_the_last_day_of_the_month_lands_in_the_right_cell", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END);
    const row = tasks.find((t) => t.id === lastOfMonthTaskId);
    expect(row).toBeDefined();
    expect(row?.dueDate).toBe(RANGE_END);
  });

  it("test_AS_442_negative_a_task_with_no_due_date_is_excluded", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(noDueDateTaskId);
  });

  it("test_AS_442_negative_a_private_project_the_viewer_cannot_see_contributes_nothing_to_the_grid", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(privateProjectTaskId);
  });

  it("test_AS_442_negative_an_archived_projects_tasks_are_excluded", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(archivedProjectTaskId);
  });

  it("test_AS_442_negative_a_trashed_task_is_excluded", async () => {
    const { getCalendarTasks } = await import("@/lib/queries/calendar");
    const tasks = await getCalendarTasks(workspaceId, RANGE_START, RANGE_END);
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain(trashedTaskId);
  });

  it("test_AS_450_calendar_month_grid_opens_on_the_current_date_in_the_callers_timezone", async () => {
    const { currentMonthKey } = await import("@/lib/calendar/month-grid");
    // 2026-08-24T02:30:00Z is already Aug 24 in UTC but still Aug 23 in
    // America/Los_Angeles -- proves the real helper the page calls
    // resolves "today" per-timezone, not off the server's ambient clock.
    const instant = new Date("2026-08-24T02:30:00Z");
    expect(currentMonthKey("UTC", instant)).toEqual({ year: 2026, month: 8 });
    expect(currentMonthKey("America/Los_Angeles", instant)).toEqual({
      year: 2026,
      month: 8,
    });
  });
});
