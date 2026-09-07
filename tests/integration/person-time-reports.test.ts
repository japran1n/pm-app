// Integration tests for the new per-person time-report RPCs
// (supabase/migrations/20261109010000_rpc_person_time_reports.sql):
// `get_person_time_by_project`, `get_person_time_daily`, and
// `get_workspace_time_by_person_and_project`. Mirrors
// tests/integration/workspace-time-by-person.test.ts (F115) for
// setup/teardown shape and the RLS/cross-workspace tampering test style.
//
// Verifies against the real linked Supabase project that:
//  - a person's time is summed correctly per-project and per-day within a
//    given date range, excluding entries outside the range
//  - a soft-deleted task's logged time is excluded from all three RPCs
//  - the workspace-by-person-and-project RPC breaks totals down per
//    project correctly
//  - a member of workspace A who calls the workspace RPC with workspace
//    B's id directly (a workspace they are NOT a member of) gets an empty
//    result, not workspace B's real, non-trivial data
//
// Skips (rather than fails) when Supabase credentials aren't present in
// the environment.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && ANON_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "person-time-reports: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

type PersonTimeByProjectRow = {
  project_id: string;
  project_name: string;
  total_minutes: number;
  billable_minutes: number;
};

type PersonTimeDailyRow = {
  entry_date: string;
  total_minutes: number;
  billable_minutes: number;
};

type WorkspaceTimeByPersonAndProjectRow = {
  user_id: string;
  project_id: string;
  project_name: string;
  billable_minutes: number;
  non_billable_minutes: number;
};

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe.skipIf(!haveAdminCreds)("person time report RPCs", () => {
  let adminClient: SupabaseClient;

  let workspaceAId: string;
  let projectOneId: string;
  let projectTwoId: string;
  let userOneId: string;
  let userTwoId: string;
  let taskOneKeptId: string;
  let taskOneDeletedId: string;
  let taskTwoId: string;
  const entryIds: string[] = [];

  // Workspace B: userOne is NOT a member; used only for the cross-workspace
  // tampering test on get_workspace_time_by_person_and_project.
  let workspaceBId: string;
  let projectBId: string;
  let taskBId: string;
  let userOnePassword: string;
  let userOneEmail: string;
  const workspaceBEntryIds: string[] = [];

  const today = new Date();
  const inRangeDateA = fmt(today);
  const inRangeDateB = fmt(new Date(today.getTime() - 24 * 60 * 60 * 1000));
  const outOfRangeDate = fmt(new Date(today.getFullYear() - 2, 0, 1));
  const rangeStart = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
  const rangeEnd = inRangeDateA;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: wsA, error: wsAErr } = await adminClient
      .from("workspaces")
      .insert({ name: "person-time-reports workspace A", slug: `ptr-a-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
    workspaceAId = wsA.id;

    userOnePassword = "Test-password-1!";
    userOneEmail = `ptr-user1-${uniqueSuffix}@example.com`;
    const { data: userOneAuth, error: userOneErr } = await adminClient.auth.admin.createUser({
      email: userOneEmail,
      password: userOnePassword,
      email_confirm: true,
    });
    if (userOneErr || !userOneAuth.user) throw new Error(`Failed to create user one: ${userOneErr?.message}`);
    userOneId = userOneAuth.user.id;

    const { data: userTwoAuth, error: userTwoErr } = await adminClient.auth.admin.createUser({
      email: `ptr-user2-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (userTwoErr || !userTwoAuth.user) throw new Error(`Failed to create user two: ${userTwoErr?.message}`);
    userTwoId = userTwoAuth.user.id;

    const { error: memberErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceAId, user_id: userOneId, role: "owner", status: "active" },
      { workspace_id: workspaceAId, user_id: userTwoId, role: "member", status: "active" },
    ]);
    if (memberErr) throw new Error(`Failed to seed workspace A membership: ${memberErr.message}`);

    const { data: projectOne, error: projectOneErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceAId, name: "PTR project one" })
      .select("id")
      .single();
    if (projectOneErr || !projectOne) throw new Error(`Failed to seed project one: ${projectOneErr?.message}`);
    projectOneId = projectOne.id;

    const { data: projectTwo, error: projectTwoErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceAId, name: "PTR project two" })
      .select("id")
      .single();
    if (projectTwoErr || !projectTwo) throw new Error(`Failed to seed project two: ${projectTwoErr?.message}`);
    projectTwoId = projectTwo.id;

    const { data: taskOneKept, error: taskOneKeptErr } = await adminClient
      .from("tasks")
      .insert({ project_id: projectOneId, title: "PTR kept task", author_id: userOneId })
      .select("id")
      .single();
    if (taskOneKeptErr || !taskOneKept) throw new Error(`Failed to seed kept task: ${taskOneKeptErr?.message}`);
    taskOneKeptId = taskOneKept.id;

    const { data: taskOneDeleted, error: taskOneDeletedErr } = await adminClient
      .from("tasks")
      .insert({ project_id: projectOneId, title: "PTR soft-deleted task", author_id: userOneId })
      .select("id")
      .single();
    if (taskOneDeletedErr || !taskOneDeleted)
      throw new Error(`Failed to seed to-be-deleted task: ${taskOneDeletedErr?.message}`);
    taskOneDeletedId = taskOneDeleted.id;

    const { data: taskTwo, error: taskTwoErr } = await adminClient
      .from("tasks")
      .insert({ project_id: projectTwoId, title: "PTR project two task", author_id: userOneId })
      .select("id")
      .single();
    if (taskTwoErr || !taskTwo) throw new Error(`Failed to seed project two task: ${taskTwoErr?.message}`);
    taskTwoId = taskTwo.id;

    // userOne: project one = 30 billable + 10 non-billable (in range, kept
    // task) + 100 billable (in range, soon-to-be-deleted task, must be
    // excluded once deleted) + 999 billable (out of range, must always be
    // excluded). project two = 20 billable on a different day (in range).
    // userTwo: project one = 45 billable (in range, kept task) — must not
    // leak into userOne's per-person totals.
    const entries = [
      { task_id: taskOneKeptId, user_id: userOneId, minutes: 30, billable: true, entry_date: inRangeDateA },
      { task_id: taskOneKeptId, user_id: userOneId, minutes: 10, billable: false, entry_date: inRangeDateA },
      { task_id: taskOneKeptId, user_id: userOneId, minutes: 999, billable: true, entry_date: outOfRangeDate },
      { task_id: taskOneDeletedId, user_id: userOneId, minutes: 100, billable: true, entry_date: inRangeDateA },
      { task_id: taskTwoId, user_id: userOneId, minutes: 20, billable: true, entry_date: inRangeDateB },
      { task_id: taskOneKeptId, user_id: userTwoId, minutes: 45, billable: true, entry_date: inRangeDateA },
    ];
    const { data: insertedEntries, error: entriesErr } = await adminClient
      .from("time_entries")
      .insert(entries)
      .select("id");
    if (entriesErr || !insertedEntries) throw new Error(`Failed to seed time entries: ${entriesErr?.message}`);
    entryIds.push(...insertedEntries.map((e) => e.id));

    // --- Workspace B setup (real, non-trivial data; userOne is NOT a member) ---
    const { data: wsB, error: wsBErr } = await adminClient
      .from("workspaces")
      .insert({ name: "person-time-reports workspace B", slug: `ptr-b-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
    workspaceBId = wsB.id;

    const { data: userThreeAuth, error: userThreeErr } = await adminClient.auth.admin.createUser({
      email: `ptr-user3-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (userThreeErr || !userThreeAuth.user) throw new Error(`Failed to create user three: ${userThreeErr?.message}`);
    const userThreeId = userThreeAuth.user.id;

    const { error: memberBErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceBId,
      user_id: userThreeId,
      role: "owner",
      status: "active",
    });
    if (memberBErr) throw new Error(`Failed to seed workspace B membership: ${memberBErr.message}`);

    const { data: projectB, error: projectBErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceBId, name: "PTR workspace B project" })
      .select("id")
      .single();
    if (projectBErr || !projectB) throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
    projectBId = projectB.id;

    const { data: taskB, error: taskBErr } = await adminClient
      .from("tasks")
      .insert({ project_id: projectBId, title: "PTR workspace B task", author_id: userThreeId })
      .select("id")
      .single();
    if (taskBErr || !taskB) throw new Error(`Failed to seed task B: ${taskBErr?.message}`);
    taskBId = taskB.id;

    const { data: insertedB, error: entriesBErr } = await adminClient
      .from("time_entries")
      .insert({ task_id: taskBId, user_id: userThreeId, minutes: 500, billable: true, entry_date: inRangeDateA })
      .select("id");
    if (entriesBErr || !insertedB) throw new Error(`Failed to seed workspace B time entry: ${entriesBErr?.message}`);
    workspaceBEntryIds.push(...insertedB.map((e) => e.id));
  });

  afterAll(async () => {
    for (const id of [...entryIds, ...workspaceBEntryIds]) {
      await adminClient.from("time_entries").delete().eq("id", id);
    }
    for (const id of [taskOneKeptId, taskOneDeletedId, taskTwoId, taskBId]) {
      if (id) await adminClient.from("tasks").delete().eq("id", id);
    }
    for (const id of [projectOneId, projectTwoId, projectBId]) {
      if (id) await adminClient.from("projects").delete().eq("id", id);
    }
    for (const id of [workspaceAId, workspaceBId]) {
      if (id) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
    }
    for (const id of [userOneId, userTwoId]) {
      if (id) await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("get_person_time_by_project: sums correct per-project totals for one person, excluding out-of-range entries and another person's time", async () => {
    const { data, error } = await adminClient.rpc("get_person_time_by_project", {
      p_user_id: userOneId,
      p_start_date: rangeStart,
      p_end_date: rangeEnd,
    });
    expect(error).toBeNull();

    const rows: PersonTimeByProjectRow[] = data ?? [];
    const projectOneRow = rows.find((r) => r.project_id === projectOneId);
    const projectTwoRow = rows.find((r) => r.project_id === projectTwoId);

    // project one: 30 + 10 (kept task, in range) + 100 (soft-deletable
    // task, not yet deleted) = 140 total, 130 billable. The 999-minute
    // out-of-range entry and userTwo's 45 minutes must not be counted.
    expect(Number(projectOneRow?.total_minutes)).toBe(140);
    expect(Number(projectOneRow?.billable_minutes)).toBe(130);

    expect(Number(projectTwoRow?.total_minutes)).toBe(20);
    expect(Number(projectTwoRow?.billable_minutes)).toBe(20);
  });

  it("get_person_time_by_project: excludes a soft-deleted task's logged time", async () => {
    const { error: deleteErr } = await adminClient
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", taskOneDeletedId);
    expect(deleteErr).toBeNull();

    const { data, error } = await adminClient.rpc("get_person_time_by_project", {
      p_user_id: userOneId,
      p_start_date: rangeStart,
      p_end_date: rangeEnd,
    });
    expect(error).toBeNull();

    const rows: PersonTimeByProjectRow[] = data ?? [];
    const projectOneRow = rows.find((r) => r.project_id === projectOneId);

    // Only the kept task's 30 + 10 minutes remain; the soft-deleted task's
    // 100 billable minutes must no longer be counted.
    expect(Number(projectOneRow?.total_minutes)).toBe(40);
    expect(Number(projectOneRow?.billable_minutes)).toBe(30);
  });

  it("get_person_time_daily: groups one person's time by day only, excluding out-of-range entries", async () => {
    const { data, error } = await adminClient.rpc("get_person_time_daily", {
      p_user_id: userOneId,
      p_start_date: rangeStart,
      p_end_date: rangeEnd,
    });
    expect(error).toBeNull();

    const rows: PersonTimeDailyRow[] = data ?? [];
    const dayARow = rows.find((r) => r.entry_date === inRangeDateA);
    const dayBRow = rows.find((r) => r.entry_date === inRangeDateB);
    const outOfRangeRow = rows.find((r) => r.entry_date === outOfRangeDate);

    // Day A: 30 + 10 minutes from the kept task (the soft-deleted task's
    // 100 minutes were excluded by the previous test's soft-delete).
    expect(Number(dayARow?.total_minutes)).toBe(40);
    expect(Number(dayARow?.billable_minutes)).toBe(30);

    // Day B: 20 minutes from project two's task.
    expect(Number(dayBRow?.total_minutes)).toBe(20);
    expect(Number(dayBRow?.billable_minutes)).toBe(20);

    expect(outOfRangeRow).toBeUndefined();
  });

  it("get_workspace_time_by_person_and_project: breaks workspace totals down per project per person", async () => {
    const { data, error } = await adminClient.rpc("get_workspace_time_by_person_and_project", {
      p_workspace_id: workspaceAId,
      p_start_date: rangeStart,
      p_end_date: rangeEnd,
    });
    expect(error).toBeNull();

    const rows: WorkspaceTimeByPersonAndProjectRow[] = data ?? [];
    const userOneProjectOne = rows.find((r) => r.user_id === userOneId && r.project_id === projectOneId);
    const userOneProjectTwo = rows.find((r) => r.user_id === userOneId && r.project_id === projectTwoId);
    const userTwoProjectOne = rows.find((r) => r.user_id === userTwoId && r.project_id === projectOneId);

    expect(Number(userOneProjectOne?.billable_minutes)).toBe(30);
    expect(Number(userOneProjectOne?.non_billable_minutes)).toBe(10);
    expect(Number(userOneProjectTwo?.billable_minutes)).toBe(20);
    expect(Number(userTwoProjectOne?.billable_minutes)).toBe(45);
  });

  it("get_workspace_time_by_person_and_project: a member of workspace A passing workspace B's id directly gets empty results, not workspace B's real data", async () => {
    const userClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: userOneEmail,
      password: userOnePassword,
    });
    expect(signInErr).toBeNull();

    // Sanity check: workspace B genuinely has non-trivial data to leak.
    const { data: adminCheck } = await adminClient.rpc("get_workspace_time_by_person_and_project", {
      p_workspace_id: workspaceBId,
      p_start_date: rangeStart,
      p_end_date: rangeEnd,
    });
    expect(Number(adminCheck?.[0]?.billable_minutes)).toBe(500);

    const { data, error } = await userClient.rpc("get_workspace_time_by_person_and_project", {
      p_workspace_id: workspaceBId,
      p_start_date: rangeStart,
      p_end_date: rangeEnd,
    });

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    // Sanity check: same session, own workspace A, still returns real data.
    const { data: ownData, error: ownError } = await userClient.rpc(
      "get_workspace_time_by_person_and_project",
      {
        p_workspace_id: workspaceAId,
        p_start_date: rangeStart,
        p_end_date: rangeEnd,
      },
    );
    expect(ownError).toBeNull();
    expect((ownData ?? []).length).toBeGreaterThan(0);
  });
});
