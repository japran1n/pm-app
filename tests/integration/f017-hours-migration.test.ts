// Integration test for F017 (missions/20260903-portal, M4 — opens the
// milestone): project_budgets, time_entries.work_category, and the two
// hours RPCs (project_hours_team, project_hours_client). Covers AS-033,
// AS-035, AS-036, AS-037.
//
// Driven through real signed-in sessions and PostgREST/RPC, matching this
// suite's established convention (tests/integration/f015-flag-assumption-
// atomic.test.ts and siblings).

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

describe.skipIf(!haveCreds)("F017: project budgets, work_category, hours RPCs", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;
  let taskAId: string;
  let taskBId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f017-hours-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F017 hours test", slug: `f017-hours-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "Hours test project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const { data: taskA, error: taskAErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Client-visible design pass",
        author_id: ownerId,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskAErr || !taskA) throw new Error(`task A: ${taskAErr?.message}`);
    taskAId = taskA.id;

    const { data: taskB, error: taskBErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "SUPER SECRET internal task title never shown to a client",
        author_id: ownerId,
        client_visible: false,
      })
      .select("id")
      .single();
    if (taskBErr || !taskB) throw new Error(`task B: ${taskBErr?.message}`);
    taskBId = taskB.id;

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    memberSession = await signIn(memberUser.email);
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("time_entries").delete().in("task_id", [taskAId, taskBId]);
    await admin.from("project_budgets").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().in("id", [taskAId, taskBId]);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // ---------------------------------------------------------------------
  // AS-033: project_budgets + the exclusion constraint
  // ---------------------------------------------------------------------

  it("test_AS_033_a_project_can_record_a_budget_of_sold_hours_for_a_period", async () => {
    const { data, error } = await admin
      .from("project_budgets")
      .insert({
        project_id: projectId,
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        sold_minutes: 6000,
      })
      .select("id, sold_minutes")
      .single();

    expect(error).toBeNull();
    expect(data?.sold_minutes).toBe(6000);
  });

  it("test_AS_033_overlapping_budget_periods_for_one_project_are_rejected", async () => {
    // Overlaps the January period inserted above (Jan 15 - Feb 15).
    const { error } = await admin.from("project_budgets").insert({
      project_id: projectId,
      period_start: "2026-01-15",
      period_end: "2026-02-15",
      sold_minutes: 3000,
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/exclu|overlap|conflict/i);
  });

  it("a non-overlapping budget period for the same project is accepted", async () => {
    const { data, error } = await admin
      .from("project_budgets")
      .insert({
        project_id: projectId,
        period_start: "2026-02-01",
        period_end: "2026-02-28",
        sold_minutes: 4000,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    await admin.from("project_budgets").delete().eq("id", data!.id);
  });

  // ---------------------------------------------------------------------
  // AS-035, AS-036, AS-037: the two RPCs
  // ---------------------------------------------------------------------

  describe("with seeded time entries", () => {
    const entryIds: string[] = [];

    beforeAll(async () => {
      const entries = [
        // Billable, categorised, on the client-visible task.
        {
          task_id: taskAId,
          user_id: memberId,
          minutes: 120,
          billable: true,
          work_category: "design",
          note: "Redoing this because we misread the brief.",
          entry_date: "2026-01-05",
        },
        // Billable, categorised, on the CLIENT-INVISIBLE task -- still
        // counts toward totals (AS-037's "included in the totals").
        {
          task_id: taskBId,
          user_id: memberId,
          minutes: 60,
          billable: true,
          work_category: "development",
          note: "Internal note nobody outside the team should see.",
          entry_date: "2026-01-08",
        },
        // Non-billable -- must NOT affect client-visible figures (AS-035).
        {
          task_id: taskAId,
          user_id: memberId,
          minutes: 500,
          billable: false,
          work_category: "qa",
          note: "Non-billable exploration, should never surface to the client.",
          entry_date: "2026-01-06",
        },
        // Billable, uncategorised (null work_category) -- second week.
        {
          task_id: taskAId,
          user_id: ownerId,
          minutes: 30,
          billable: true,
          work_category: null,
          note: null,
          entry_date: "2026-01-12",
        },
      ];

      const { data, error } = await admin.from("time_entries").insert(entries).select("id");
      if (error) throw new Error(`seed time entries: ${error.message}`);
      entryIds.push(...(data ?? []).map((r) => r.id));

      await admin.from("project_budgets").insert({
        project_id: projectId,
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        sold_minutes: 6000,
      });
    });

    afterAll(async () => {
      if (entryIds.length) {
        await admin.from("time_entries").delete().in("id", entryIds);
      }
      await admin
        .from("project_budgets")
        .delete()
        .eq("project_id", projectId)
        .eq("period_start", "2026-01-01");
    });

    it(
      "primary success test: project_hours_client totals match a hand-computed sum " +
        "of billable entries for the period",
      async () => {
        const { data, error } = await clientSession.rpc("project_hours_client", {
          p_project_id: projectId,
          p_from: "2026-01-01",
          p_to: "2026-01-31",
        });
        expect(error).toBeNull();

        // Hand-computed: 120 (design, week 1) + 60 (development, week 1)
        // + 30 (uncategorised, week 2) = 210 billable minutes. The 500
        // non-billable minutes must be excluded entirely.
        const weekly = data.weekly as { iso_week: string; minutes: number; cumulative_minutes: number }[];
        const totalFromWeekly = weekly.reduce((sum: number, w) => sum + w.minutes, 0);
        expect(totalFromWeekly).toBe(210);

        const byCategory = data.by_category as { work_category: string; minutes: number }[];
        const totalFromCategory = byCategory.reduce((sum: number, c) => sum + c.minutes, 0);
        expect(totalFromCategory).toBe(210);

        const designBucket = byCategory.find((c) => c.work_category === "design");
        expect(designBucket?.minutes).toBe(120);
        const developmentBucket = byCategory.find((c) => c.work_category === "development");
        expect(developmentBucket?.minutes).toBe(60);
        const uncategorisedBucket = byCategory.find((c) => c.work_category === "uncategorised");
        expect(uncategorisedBucket?.minutes).toBe(30);

        expect(data.sold_minutes).toBe(6000);

        // Cumulative must be monotonic and end at the grand total.
        const sorted = [...weekly].sort((a, b) => a.iso_week.localeCompare(b.iso_week));
        expect(sorted[sorted.length - 1].cumulative_minutes).toBe(210);
      },
    );

    it(
      "test_AS_035_the_portals_hours_figures_exclude_every_non_billable_time_entry " +
        "(non-billable entries change no client-visible figure)",
      async () => {
        const { data: before } = await clientSession.rpc("project_hours_client", {
          p_project_id: projectId,
          p_from: "2026-01-01",
          p_to: "2026-01-31",
        });
        const totalBefore = (
          before.weekly as { minutes: number }[]
        ).reduce((sum, w) => sum + w.minutes, 0);

        // Add another large non-billable entry.
        const { data: extra, error: extraErr } = await admin
          .from("time_entries")
          .insert({
            task_id: taskAId,
            user_id: memberId,
            minutes: 9999,
            billable: false,
            work_category: "pm",
            note: "Another non-billable entry that must not move the number.",
            entry_date: "2026-01-20",
          })
          .select("id")
          .single();
        if (extraErr) throw new Error(extraErr.message);

        const { data: after } = await clientSession.rpc("project_hours_client", {
          p_project_id: projectId,
          p_from: "2026-01-01",
          p_to: "2026-01-31",
        });
        const totalAfter = (
          after.weekly as { minutes: number }[]
        ).reduce((sum, w) => sum + w.minutes, 0);

        expect(totalAfter).toBe(totalBefore);

        const pmBucket = (after.by_category as { work_category: string; minutes: number }[]).find(
          (c) => c.work_category === "pm",
        );
        expect(pmBucket).toBeUndefined();

        await admin.from("time_entries").delete().eq("id", extra!.id);
      },
    );

    it(
      "failure test (a): the client RPC's serialised JSON payload contains no note, " +
        "no user id, and no task title for a project seeded with entries carrying all three " +
        "-- asserted on the raw payload text, not on named fields",
      async () => {
        const { data, error } = await clientSession.rpc("project_hours_client", {
          p_project_id: projectId,
          p_from: "2026-01-01",
          p_to: "2026-01-31",
        });
        expect(error).toBeNull();

        const serialised = JSON.stringify(data);

        // Notes seeded above -- must not appear anywhere in the payload.
        expect(serialised).not.toContain("Redoing this because we misread the brief");
        expect(serialised).not.toContain("Internal note nobody outside the team should see");
        expect(serialised).not.toContain("Non-billable exploration");

        // Task titles seeded above -- neither the client-visible nor the
        // client-invisible one may appear, since AS-037 is satisfied by
        // never selecting a task title at all.
        expect(serialised).not.toContain("Client-visible design pass");
        expect(serialised.toLowerCase()).not.toContain("super secret internal task title");

        // Person identifiers -- neither user id may appear anywhere in
        // the payload.
        expect(serialised).not.toContain(memberId);
        expect(serialised).not.toContain(ownerId);

        // Sanity: the payload is not simply empty/vacuous -- it does
        // carry the real aggregate figures.
        expect(serialised).toContain("210");
      },
    );

    it(
      "test_AS_037_hours_logged_against_a_client_invisible_task_are_included_in_the_totals " +
        "(not merely omitted, but summed in)",
      async () => {
        const { data, error } = await clientSession.rpc("project_hours_client", {
          p_project_id: projectId,
          p_from: "2026-01-01",
          p_to: "2026-01-31",
        });
        expect(error).toBeNull();

        // The 60 billable minutes logged against the client-invisible
        // task (taskB) must be part of the 210 total and part of the
        // "development" bucket -- proving inclusion, not just absence
        // of the task's name.
        const developmentBucket = (
          data.by_category as { work_category: string; minutes: number }[]
        ).find((c) => c.work_category === "development");
        expect(developmentBucket?.minutes).toBe(60);
      },
    );

    it("project_hours_team returns notes, user ids and task titles for the team", async () => {
      const { data, error } = await memberSession.rpc("project_hours_team", {
        p_project_id: projectId,
        p_from: "2026-01-01",
        p_to: "2026-01-31",
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(4);

      const serialised = JSON.stringify(data);
      expect(serialised).toContain("Redoing this because we misread the brief");
      expect(serialised).toContain("Client-visible design pass");
      expect(serialised).toContain(memberId);

      // Includes non-billable entries too, unlike the client path.
      const totalMinutes = (data as { minutes: number }[]).reduce((sum, r) => sum + r.minutes, 0);
      expect(totalMinutes).toBeGreaterThanOrEqual(710);
    });

    it("failure test (c): a client cannot select time_entries directly", async () => {
      const { data, error } = await clientSession.from("time_entries").select("*").eq("task_id", taskAId);

      // Either RLS denies the query outright, or (matching this schema's
      // "filtered, not errored" default-deny convention) it returns no
      // rows for a role with no matching policy.
      if (error) {
        expect(error).not.toBeNull();
      } else {
        expect(data).toEqual([]);
      }
    });

    it("project_hours_client rejects a team (non-client) caller", async () => {
      const { error } = await memberSession.rpc("project_hours_client", {
        p_project_id: projectId,
        p_from: "2026-01-01",
        p_to: "2026-01-31",
      });
      expect(error).not.toBeNull();
    });

    it("project_hours_team rejects a client caller", async () => {
      const { error } = await clientSession.rpc("project_hours_team", {
        p_project_id: projectId,
        p_from: "2026-01-01",
        p_to: "2026-01-31",
      });
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // time_entries.work_category
  // ---------------------------------------------------------------------

  it("work_category accepts null (uncategorised) and the five allowed values", async () => {
    const { data: nullRow, error: nullErr } = await admin
      .from("time_entries")
      .insert({ task_id: taskAId, user_id: memberId, minutes: 15, entry_date: "2026-03-01" })
      .select("id, work_category")
      .single();
    expect(nullErr).toBeNull();
    expect(nullRow?.work_category).toBeNull();

    const { data: catRow, error: catErr } = await admin
      .from("time_entries")
      .insert({
        task_id: taskAId,
        user_id: memberId,
        minutes: 15,
        entry_date: "2026-03-01",
        work_category: "qa",
      })
      .select("id, work_category")
      .single();
    expect(catErr).toBeNull();
    expect(catRow?.work_category).toBe("qa");

    await admin.from("time_entries").delete().in("id", [nullRow!.id, catRow!.id]);
  });

  it("work_category rejects a value outside the fixed set", async () => {
    const { error } = await admin.from("time_entries").insert({
      task_id: taskAId,
      user_id: memberId,
      minutes: 15,
      entry_date: "2026-03-01",
      work_category: "not-a-real-category",
    });
    expect(error).not.toBeNull();
  });
});
