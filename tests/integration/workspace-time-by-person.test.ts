// Integration test for F115's `get_workspace_time_by_person` RPC
// (AS-173, AS-174), plus a real cross-workspace parameter-tampering test
// (AS-176 territory, exercised here per F115's Definition of done since
// this is the feature that would leak data if RLS/RPC scoping were wrong).
//
// Verifies against the real linked Supabase project that:
//  - per-person billable/non-billable minutes are summed correctly across
//    several members' time entries within a given date range, and entries
//    outside the range are excluded
//  - a soft-deleted task's logged time is excluded from the per-person
//    totals (AS-174)
//  - a member of workspace A who calls the RPC passing workspace B's id
//    directly (a workspace they are NOT a member of) gets an empty result,
//    not workspace B's real, non-trivial data — mirroring F077's AS-133
//    test style (tests/integration/dashboard-rls-cross-workspace.test.ts)
//
// Skips (rather than fails) when Supabase credentials aren't present in
// the environment. Mirrors tests/integration/project-time-totals.test.ts
// (F114) for setup/teardown shape.

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

type WorkspaceTimeRow = {
  user_id: string;
  billable_minutes: number;
  non_billable_minutes: number;
};

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe.skipIf(!haveAdminCreds)(
  "get_workspace_time_by_person RPC (F115)",
  () => {
    let adminClient: SupabaseClient;

    // Workspace A: the workspace under test for correctness assertions.
    let workspaceAId: string;
    let projectAId: string;
    let userOneId: string;
    let userTwoId: string;
    let taskKeptId: string;
    let taskDeletedId: string;
    const entryIds: string[] = [];

    // Workspace B: seeded with real, non-trivial data, used only for the
    // cross-workspace tampering test. userOne is a member of workspace A
    // and explicitly NOT a member of workspace B.
    let workspaceBId: string;
    let projectBId: string;
    let taskBId: string;
    let userOnePassword: string;
    let userOneEmail: string;
    const workspaceBEntryIds: string[] = [];

    const today = new Date();
    const inRangeDate = fmt(today);
    const outOfRangeDate = fmt(new Date(today.getFullYear() - 2, 0, 1));
    const rangeStart = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
    const rangeEnd = inRangeDate;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // --- Workspace A setup ---
      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F115 report workspace A", slug: `f115-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      userOnePassword = "Test-password-1!";
      userOneEmail = `f115-user1-${uniqueSuffix}@example.com`;
      const { data: userOneAuth, error: userOneErr } =
        await adminClient.auth.admin.createUser({
          email: userOneEmail,
          password: userOnePassword,
          email_confirm: true,
        });
      if (userOneErr || !userOneAuth.user) {
        throw new Error(`Failed to create user one: ${userOneErr?.message}`);
      }
      userOneId = userOneAuth.user.id;

      const { data: userTwoAuth, error: userTwoErr } =
        await adminClient.auth.admin.createUser({
          email: `f115-user2-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (userTwoErr || !userTwoAuth.user) {
        throw new Error(`Failed to create user two: ${userTwoErr?.message}`);
      }
      userTwoId = userTwoAuth.user.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceAId, user_id: userOneId, role: "owner", status: "active" },
        { workspace_id: workspaceAId, user_id: userTwoId, role: "member", status: "active" },
      ]);
      if (memberErr) {
        throw new Error(`Failed to seed workspace A membership: ${memberErr.message}`);
      }

      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F115 report project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      const { data: taskKept, error: taskKeptErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F115 kept task", author_id: userOneId })
        .select("id")
        .single();
      if (taskKeptErr || !taskKept) {
        throw new Error(`Failed to seed kept task: ${taskKeptErr?.message}`);
      }
      taskKeptId = taskKept.id;

      const { data: taskDeleted, error: taskDeletedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "F115 soft-deleted task",
          author_id: userOneId,
        })
        .select("id")
        .single();
      if (taskDeletedErr || !taskDeleted) {
        throw new Error(`Failed to seed to-be-deleted task: ${taskDeletedErr?.message}`);
      }
      taskDeletedId = taskDeleted.id;

      // userOne: 30 billable + 10 non-billable minutes in range, plus 999
      // minutes outside the date range (must be excluded).
      // userTwo: 45 billable minutes in range on the same task.
      // taskDeleted: 100 billable minutes for userOne, must be excluded by
      // AS-174 once the task is soft-deleted.
      const entries = [
        { task_id: taskKeptId, user_id: userOneId, minutes: 30, billable: true, entry_date: inRangeDate },
        { task_id: taskKeptId, user_id: userOneId, minutes: 10, billable: false, entry_date: inRangeDate },
        { task_id: taskKeptId, user_id: userOneId, minutes: 999, billable: true, entry_date: outOfRangeDate },
        { task_id: taskKeptId, user_id: userTwoId, minutes: 45, billable: true, entry_date: inRangeDate },
        { task_id: taskDeletedId, user_id: userOneId, minutes: 100, billable: true, entry_date: inRangeDate },
      ];
      const { data: insertedEntries, error: entriesErr } = await adminClient
        .from("time_entries")
        .insert(entries)
        .select("id");
      if (entriesErr || !insertedEntries) {
        throw new Error(`Failed to seed time entries: ${entriesErr?.message}`);
      }
      entryIds.push(...insertedEntries.map((e) => e.id));

      // --- Workspace B setup (real, non-trivial data; userOne is NOT a member) ---
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F115 report workspace B", slug: `f115-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      const { data: userThreeAuth, error: userThreeErr } =
        await adminClient.auth.admin.createUser({
          email: `f115-user3-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (userThreeErr || !userThreeAuth.user) {
        throw new Error(`Failed to create user three: ${userThreeErr?.message}`);
      }
      const userThreeId = userThreeAuth.user.id;

      const { error: memberBErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: userThreeId,
        role: "owner",
        status: "active",
      });
      if (memberBErr) {
        throw new Error(`Failed to seed workspace B membership: ${memberBErr.message}`);
      }

      const { data: projectB, error: projectBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "F115 report project B" })
        .select("id")
        .single();
      if (projectBErr || !projectB) {
        throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
      }
      projectBId = projectB.id;

      const { data: taskB, error: taskBErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectBId, title: "F115 workspace B task", author_id: userThreeId })
        .select("id")
        .single();
      if (taskBErr || !taskB) {
        throw new Error(`Failed to seed task B: ${taskBErr?.message}`);
      }
      taskBId = taskB.id;

      const { data: insertedB, error: entriesBErr } = await adminClient
        .from("time_entries")
        .insert({
          task_id: taskBId,
          user_id: userThreeId,
          minutes: 500,
          billable: true,
          entry_date: inRangeDate,
        })
        .select("id");
      if (entriesBErr || !insertedB) {
        throw new Error(`Failed to seed workspace B time entry: ${entriesBErr?.message}`);
      }
      workspaceBEntryIds.push(...insertedB.map((e) => e.id));
    });

    afterAll(async () => {
      for (const id of [...entryIds, ...workspaceBEntryIds]) {
        await adminClient.from("time_entries").delete().eq("id", id);
      }
      for (const id of [taskKeptId, taskDeletedId, taskBId]) {
        if (id) await adminClient.from("tasks").delete().eq("id", id);
      }
      for (const id of [projectAId, projectBId]) {
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

    it("AS-173: sums correct per-person billable/non-billable totals within the date range, excluding out-of-range entries", async () => {
      const { data, error } = await adminClient.rpc("get_workspace_time_by_person", {
        p_workspace_id: workspaceAId,
        p_start_date: rangeStart,
        p_end_date: rangeEnd,
      });
      expect(error).toBeNull();

      const rows: WorkspaceTimeRow[] = data ?? [];
      const userOneRow = rows.find((r) => r.user_id === userOneId);
      const userTwoRow = rows.find((r) => r.user_id === userTwoId);

      // userOne: 30 billable (in range) + 100 billable (soft-deleted task,
      // not yet deleted) = 130; 10 non-billable. The 999-minute entry
      // outside the date range must not be counted.
      expect(Number(userOneRow?.billable_minutes)).toBe(130);
      expect(Number(userOneRow?.non_billable_minutes)).toBe(10);

      // userTwo: 45 billable, 0 non-billable.
      expect(Number(userTwoRow?.billable_minutes)).toBe(45);
      expect(Number(userTwoRow?.non_billable_minutes)).toBe(0);
    });

    it("AS-174: soft-deleting a task drops its logged time from the per-person totals", async () => {
      const { error: deleteErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", taskDeletedId);
      expect(deleteErr).toBeNull();

      const { data, error } = await adminClient.rpc("get_workspace_time_by_person", {
        p_workspace_id: workspaceAId,
        p_start_date: rangeStart,
        p_end_date: rangeEnd,
      });
      expect(error).toBeNull();

      const rows: WorkspaceTimeRow[] = data ?? [];
      const userOneRow = rows.find((r) => r.user_id === userOneId);

      // Only the kept task's 30 billable minutes remain for userOne; the
      // soft-deleted task's 100 billable minutes must no longer be counted.
      expect(Number(userOneRow?.billable_minutes)).toBe(30);
      expect(Number(userOneRow?.non_billable_minutes)).toBe(10);
    });

    it("AS-176: a member of workspace A passing workspace B's id directly gets empty results, not workspace B's real data", async () => {
      // Sign in as userOne (a member of workspace A, NOT a member of
      // workspace B) with a real session, then call the RPC with
      // workspace B's id as the direct parameter — the adversarial path
      // AS-176 describes (valid session in a different workspace).
      const userClient = createClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await userClient.auth.signInWithPassword({
        email: userOneEmail,
        password: userOnePassword,
      });
      expect(signInErr).toBeNull();

      // Sanity check: workspace B genuinely has non-trivial data to leak
      // (proven via the admin client, bypassing RLS) — a zero/empty result
      // from the user client below is proof of RLS/RPC enforcement, not an
      // artifact of workspace B having nothing to leak.
      const { data: adminCheck } = await adminClient.rpc("get_workspace_time_by_person", {
        p_workspace_id: workspaceBId,
        p_start_date: rangeStart,
        p_end_date: rangeEnd,
      });
      expect(Number(adminCheck?.[0]?.billable_minutes)).toBe(500);

      const { data, error } = await userClient.rpc("get_workspace_time_by_person", {
        p_workspace_id: workspaceBId,
        p_start_date: rangeStart,
        p_end_date: rangeEnd,
      });

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      // Sanity check: the same user, same session, querying their own
      // workspace A still returns real data — proving the empty result
      // above isn't caused by a broken auth session.
      const { data: ownData, error: ownError } = await userClient.rpc(
        "get_workspace_time_by_person",
        {
          p_workspace_id: workspaceAId,
          p_start_date: rangeStart,
          p_end_date: rangeEnd,
        },
      );
      expect(ownError).toBeNull();
      expect((ownData ?? []).length).toBeGreaterThan(0);

      await userClient.auth.signOut();
    });
  },
);
