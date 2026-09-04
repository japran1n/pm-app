// Integration test for F021b (missions/20260903-portal, M4 remediation --
// blocker). Covers AS-034.
//
// The defect: `hours/page.tsx` used to query `project_hours_client` over
// an unbounded "2000-01-01 through today" window, so a project with a
// closed 2025 budget (40h used) and a current 2026 budget (5h of 40h
// used) reported Used 45h, Remaining 0h, "+5h Over" -- summing two
// different budget periods into one set of figures, wrong in the
// direction that starts a false conversation about an overrun.
//
// This fixture reproduces exactly that shape (two periods, entries in
// both) and asserts the fixed read path -- `project_current_budget_period`
// + `project_hours_client` scoped to that one period's own bounds --
// reports only the current period's figures, never the sum.
//
// Driven through real signed-in sessions and PostgREST/RPC, matching
// this suite's established convention
// (tests/integration/f017-hours-migration.test.ts and siblings).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

describe.skipIf(!haveCreds)("F021b: the hours view describes one budget period", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string;
  let taskId: string;

  const createdUserIds: string[] = [];

  const today = new Date();
  // Closed past period: safely before the current period below, entirely
  // in the past relative to "today" whatever "today" is when this runs.
  const pastStart = isoDate(addDays(today, -400));
  const pastEnd = isoDate(addDays(today, -370));
  const pastEntryDate = isoDate(addDays(today, -385));
  // Current period: covers today.
  const currentStart = isoDate(addDays(today, -10));
  const currentEnd = isoDate(addDays(today, 20));
  const currentEntryDate = isoDate(today);

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f021b-hours-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F021b hours test", slug: `f021b-hours-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F021b hours period scoping",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F021b fixture task",
        author_id: ownerId,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskErr || !task) throw new Error(`task: ${taskErr?.message}`);
    taskId = task.id;

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("time_entries").delete().eq("task_id", taskId);
    await admin.from("project_budgets").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("id", taskId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  describe("two budget periods, entries in both -- the point of this feature", () => {
    beforeAll(async () => {
      // Closed period: 40h sold, 40h (2400 min) used.
      await admin.from("project_budgets").insert({
        project_id: projectId,
        period_start: pastStart,
        period_end: pastEnd,
        sold_minutes: 2400,
      });
      // Current period: 40h sold, 5h (300 min) used.
      await admin.from("project_budgets").insert({
        project_id: projectId,
        period_start: currentStart,
        period_end: currentEnd,
        sold_minutes: 2400,
      });

      await admin.from("time_entries").insert([
        {
          task_id: taskId,
          user_id: ownerId,
          minutes: 2400,
          billable: true,
          entry_date: pastEntryDate,
        },
        {
          task_id: taskId,
          user_id: ownerId,
          minutes: 300,
          billable: true,
          entry_date: currentEntryDate,
        },
      ]);
    });

    afterAll(async () => {
      await admin.from("time_entries").delete().eq("task_id", taskId);
      await admin.from("project_budgets").delete().eq("project_id", projectId);
    });

    it(
      "test_AS_034_current_budget_period_resolves_to_the_period_covering_today_not_the_closed_one",
      async () => {
        const { data, error } = await clientSession.rpc("project_current_budget_period", {
          p_project_id: projectId,
        });
        expect(error).toBeNull();
        const row = (data ?? [])[0] as
          | { period_start: string; period_end: string; has_other_periods: boolean }
          | undefined;
        expect(row).toBeTruthy();
        expect(row!.period_start).toBe(currentStart);
        expect(row!.period_end).toBe(currentEnd);
        expect(row!.has_other_periods).toBe(true);
      },
    );

    it(
      "test_AS_034_primary_success_the_two_period_fixture_reports_only_the_current_periods_" +
        "used_remaining_and_series_not_the_sum",
      async () => {
        const { data: periodRow } = await clientSession.rpc("project_current_budget_period", {
          p_project_id: projectId,
        });
        const period = (periodRow ?? [])[0] as { period_start: string; period_end: string };

        const { data, error } = await clientSession.rpc("project_hours_client", {
          p_project_id: projectId,
          p_from: period.period_start,
          p_to: period.period_end,
        });
        expect(error).toBeNull();

        const weekly = data.weekly as { minutes: number }[];
        const totalUsed = weekly.reduce((sum, w) => sum + w.minutes, 0);

        // BEFORE this feature's fix: querying with the old unbounded
        // "2000-01-01 through today" window on this same fixture reports
        // 2700 (2400 + 300) used against a single 2400 sold_minutes,
        // i.e. Used 45h, Remaining 0h, "+5h Over" -- the exact defect
        // described in this feature's spec. AFTER the fix (scoping to
        // the current period only), it must report only the current
        // period's own 300 minutes used.
        expect(totalUsed).toBe(300);
        expect(data.sold_minutes).toBe(2400);

        // The closed period's 2400 minutes must not have leaked in.
        expect(totalUsed).not.toBe(2700);
      },
    );

    it("failure test: querying the OLD unbounded window on this same fixture reproduces the defect", async () => {
      // Demonstrates the pre-fix RPC call shape still exists (the RPC
      // itself is generic over [p_from, p_to]) and that an unscoped wide
      // window is what produces the false overrun -- proving the fix is
      // the page's period selection, not a change to the RPC's own
      // aggregation logic.
      const { data, error } = await clientSession.rpc("project_hours_client", {
        p_project_id: projectId,
        p_from: "2000-01-01",
        p_to: isoDate(addDays(today, 30)),
      });
      expect(error).toBeNull();
      const weekly = data.weekly as { minutes: number }[];
      const totalUsed = weekly.reduce((sum, w) => sum + w.minutes, 0);
      expect(totalUsed).toBe(2700);
    });
  });

  describe("a single-period project is unchanged", () => {
    const soloStart = isoDate(addDays(today, -5));
    const soloEnd = isoDate(addDays(today, 25));
    const soloEntryDate = isoDate(today);

    beforeAll(async () => {
      await admin.from("project_budgets").insert({
        project_id: projectId,
        period_start: soloStart,
        period_end: soloEnd,
        sold_minutes: 1200,
      });
      await admin.from("time_entries").insert({
        task_id: taskId,
        user_id: ownerId,
        minutes: 90,
        billable: true,
        entry_date: soloEntryDate,
      });
    });

    afterAll(async () => {
      await admin.from("time_entries").delete().eq("task_id", taskId);
      await admin.from("project_budgets").delete().eq("project_id", projectId);
    });

    it("test_AS_034_failure_a_single_period_project_reports_that_periods_own_figures_unchanged", async () => {
      const { data: periodRow } = await clientSession.rpc("project_current_budget_period", {
        p_project_id: projectId,
      });
      const period = (periodRow ?? [])[0] as {
        period_start: string;
        period_end: string;
        has_other_periods: boolean;
      };
      expect(period.period_start).toBe(soloStart);
      expect(period.period_end).toBe(soloEnd);
      expect(period.has_other_periods).toBe(false);

      const { data, error } = await clientSession.rpc("project_hours_client", {
        p_project_id: projectId,
        p_from: period.period_start,
        p_to: period.period_end,
      });
      expect(error).toBeNull();
      const weekly = data.weekly as { minutes: number }[];
      const totalUsed = weekly.reduce((sum, w) => sum + w.minutes, 0);
      expect(totalUsed).toBe(90);
      expect(data.sold_minutes).toBe(1200);
    });
  });

  it("a project with no budget at all returns no current period row", async () => {
    const { data, error } = await clientSession.rpc("project_current_budget_period", {
      p_project_id: projectId,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});
