// Integration test for F018 (missions/20260903-portal, M4): the daily
// budget-threshold sweep (public.sweep_project_budget_thresholds) and the
// team/viewer/client write gates on project_budgets. Covers AS-033
// (budget recording + its authz gate) and this feature's own Definition
// of done primary success test ("the sweep writes exactly one
// notification per threshold per period, and nothing on a second run").
//
// Driven through real signed-in sessions and PostgREST/RPC, matching this
// suite's established convention (tests/integration/f017-hours-migration.test.ts
// and siblings).

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

describe.skipIf(!haveCreds)("F018: budget threshold sweep + project_budgets authz", () => {
  let admin: SupabaseClient;
  let viewerSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let leadId: string;
  let viewerId: string;
  let clientId: string;
  let taskId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f018-budget-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const leadUser = await makeUser("lead");
    const viewerUser = await makeUser("viewer");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    leadId = leadUser.id;
    viewerId = viewerUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F018 budget test", slug: `f018-budget-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: leadId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "Budget test project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: leadId, project_role: "lead", added_by: ownerId },
    ]);

    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .insert({ project_id: projectId, title: "Budget sweep task", author_id: ownerId })
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
    viewerSession = await signIn(viewerUser.email);
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("notifications").delete().eq("project_id", projectId);
    await admin.from("time_entries").delete().eq("task_id", taskId);
    await admin.from("project_budgets").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("id", taskId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // ---------------------------------------------------------------------
  // AS-033's own failure test (this feature's Definition of done):
  // "a viewer and a client cannot create or edit a budget."
  // ---------------------------------------------------------------------

  it("test_AS_033_a_viewer_cannot_create_a_budget", async () => {
    const { error } = await viewerSession.from("project_budgets").insert({
      project_id: projectId,
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      sold_minutes: 6000,
    });
    // project_budgets_insert_team requires is_project_workspace_writer,
    // which excludes viewer -- RLS rejects the write.
    expect(error).not.toBeNull();
  });

  it("test_AS_033_a_client_cannot_create_a_budget", async () => {
    const { error } = await clientSession.from("project_budgets").insert({
      project_id: projectId,
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      sold_minutes: 6000,
    });
    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Primary success test: the sweep writes exactly one notification per
  // threshold per period, and nothing on a second run.
  // ---------------------------------------------------------------------

  it("test_AS_038_sweep_notifies_once_per_threshold_per_period_and_is_idempotent_on_rerun", async () => {
    const { data: budget, error: budgetErr } = await admin
      .from("project_budgets")
      .insert({
        project_id: projectId,
        period_start: "2020-01-01",
        period_end: "2099-12-31",
        sold_minutes: 100,
      })
      .select("id")
      .single();
    if (budgetErr || !budget) throw new Error(`budget: ${budgetErr?.message}`);

    // 85 billable minutes logged against 100 sold -- crosses 80%, not 100%.
    await admin.from("time_entries").insert({
      task_id: taskId,
      user_id: leadId,
      minutes: 85,
      billable: true,
      entry_date: "2026-01-15",
    });

    const { error: runError } = await admin.rpc("sweep_project_budget_thresholds");
    expect(runError).toBeNull();

    const { data: firstRun } = await admin
      .from("notifications")
      .select("id, kind, user_id")
      .eq("project_id", projectId)
      .eq("kind", "budget_threshold_80");

    expect(firstRun ?? []).toHaveLength(1);
    expect(firstRun?.[0]?.user_id).toBe(leadId);

    // Second run, same period, same spend: must not write a second
    // 80% notification (idempotent).
    const { error: rerunError } = await admin.rpc("sweep_project_budget_thresholds");
    expect(rerunError).toBeNull();

    const { data: afterRerun } = await admin
      .from("notifications")
      .select("id")
      .eq("project_id", projectId)
      .eq("kind", "budget_threshold_80");

    expect(afterRerun ?? []).toHaveLength(1);

    // Push spend to 100%+ and re-run: a NEW notification (100%) is
    // written, on top of the still-single 80% one -- one per threshold.
    await admin.from("time_entries").insert({
      task_id: taskId,
      user_id: leadId,
      minutes: 20,
      billable: true,
      entry_date: "2026-01-16",
    });

    const { error: thirdRunError } = await admin.rpc("sweep_project_budget_thresholds");
    expect(thirdRunError).toBeNull();

    const { data: eightyAfterThreshold } = await admin
      .from("notifications")
      .select("id")
      .eq("project_id", projectId)
      .eq("kind", "budget_threshold_80");
    expect(eightyAfterThreshold ?? []).toHaveLength(1);

    const { data: hundred } = await admin
      .from("notifications")
      .select("id, user_id")
      .eq("project_id", projectId)
      .eq("kind", "budget_threshold_100");
    expect(hundred ?? []).toHaveLength(1);
    expect(hundred?.[0]?.user_id).toBe(leadId);
  }, 30_000);
});
