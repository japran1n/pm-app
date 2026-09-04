// Integration test for F084 (missions/20260903-portal): the defect is
// that `approve_portal_task_atomic` and `request_portal_task_changes_atomic`
// (20260906010000) had byte-identical bodies -- a client rejecting a task
// was recorded exactly as if they had approved it, with no distinguishable,
// durable record anywhere in the database. Fixed by
// 20261026010000_f084_portal_task_decision_audit_and_kinds.sql, which adds
// a `write_audit_log_entry` call to each RPC with a distinct `action`
// ('task.approved' vs 'task.changes_requested').
//
// This test calls both RPCs directly (as authenticated signed-in clients,
// same shape as tests/integration/f009b-close-second-approval-path.test.ts)
// and asserts on `audit_log` afterwards -- it is written to FAIL against
// the pre-fix schema (both RPCs leaving zero distinguishing trace) and
// PASS once the migration lands.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F084: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

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

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveCreds)("F084 — request-changes leaves a distinguishable record from approve", () => {
  let admin: SupabaseClient;

  let workspaceId: string;
  let ownerId: string;

  let projectId: string;
  let approveTaskId: string;
  let rejectTaskId: string;

  let clientId: string;
  let clientEmail: string;

  const createdUserIds: string[] = [];

  async function signInAs(email: string) {
    const signInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await signInClient.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
    currentTestClient = signInClient as unknown as typeof currentTestClient;
    return signInClient;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({
      email: `f084-owner-${suffix}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (ownerErr || !ownerUser.user) throw new Error(`owner: ${ownerErr?.message}`);
    ownerId = ownerUser.user.id;
    createdUserIds.push(ownerId);

    const { data: clientUser, error: clientErr } = await admin.auth.admin.createUser({
      email: `f084-client-${suffix}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (clientErr || !clientUser.user) throw new Error(`client: ${clientErr?.message}`);
    clientId = clientUser.user.id;
    clientEmail = clientUser.user.email!;
    createdUserIds.push(clientId);

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F084 test", slug: `f084-${suffix}` })
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
        name: "F084 project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert({
      project_id: projectId,
      user_id: clientId,
      project_role: "member",
      added_by: ownerId,
    });

    // Any decision type is enough for the task-page legacy path (see
    // assert_portal_task_actionable_by_client, 20260925010000_f009b).
    await admin.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "content",
      user_id: clientId,
    });

    const mkTask = async (title: string) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          status: "todo",
          author_id: ownerId,
          client_visible: true,
          pending_client_approval: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
      return data.id as string;
    };

    approveTaskId = await mkTask("F084 approve task");
    rejectTaskId = await mkTask("F084 reject task");

    await signInAs(clientEmail);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("audit_log").delete().eq("workspace_id", workspaceId);
    await admin.from("project_decision_owners").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("test_F084_request_changes_writes_an_audit_log_entry_distinct_from_approve", async () => {
    const { error: approveError } = await currentTestClient.rpc("approve_portal_task_atomic", {
      p_task_id: approveTaskId,
    });
    expect(approveError).toBeNull();

    const { error: rejectError } = await currentTestClient.rpc("request_portal_task_changes_atomic", {
      p_task_id: rejectTaskId,
    });
    expect(rejectError).toBeNull();

    const { data: approveEntries } = await admin
      .from("audit_log")
      .select("action, target_id")
      .eq("workspace_id", workspaceId)
      .eq("target_id", approveTaskId);

    const { data: rejectEntries } = await admin
      .from("audit_log")
      .select("action, target_id")
      .eq("workspace_id", workspaceId)
      .eq("target_id", rejectTaskId);

    // The core assertion: rejecting a task must leave SOME record, and it
    // must be a DIFFERENT record than approving one -- pre-fix, neither
    // RPC wrote to audit_log at all, so both of these fail against the
    // unfixed schema.
    expect(approveEntries?.length ?? 0).toBeGreaterThan(0);
    expect(rejectEntries?.length ?? 0).toBeGreaterThan(0);

    const approveActions = (approveEntries ?? []).map((row) => row.action);
    const rejectActions = (rejectEntries ?? []).map((row) => row.action);

    expect(approveActions).not.toEqual(rejectActions);
    expect(rejectActions.some((action) => action.includes("changes_requested"))).toBe(true);
    expect(approveActions.some((action) => action.includes("approved"))).toBe(true);
  }, 30_000);
});
