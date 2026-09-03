// Integration test for F009 (missions/20260903-portal, M2 — Approvals):
// `decideApproval` (lib/actions/portal-approval.ts), the Server Action
// wrapper around `decide_approval_atomic`. Covers AS-023 (primary success:
// the decider, timestamp and decision are recorded in one transaction and
// the linked task's pending-approval flag clears) and AS-022 (failure: a
// non-owner calling the action directly is rejected — no row changes).
//
// `decide_approval_atomic` itself is already exhaustively covered by
// tests/integration/f007-approvals-rls.test.ts (direct RPC calls, every
// ownership/state/portal-gate edge case). This file exists because F009
// adds a NEW caller of that RPC (the Server Action a real client session
// actually invokes from the portal) — same real-signed-in-session,
// mocked-`createClient`-only pattern as tests/integration/
// f008-request-approval-action.test.ts, not a re-proof of the RPC's own
// SQL.

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
    "F009: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveCreds)("F009 decideApproval (AS-022, AS-023)", () => {
  let adminClient: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string; // the named 'content' decision owner
  let coClientId: string; // a client, but NOT the decision owner

  let taskId: string;
  let clientEmail: string;
  let coClientEmail: string;

  const createdUserIds: string[] = [];

  async function signInAs(email: string) {
    const signInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await signInClient.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
    currentTestClient = signInClient as unknown as typeof currentTestClient;
  }

  async function insertPendingRequest() {
    const { data, error } = await adminClient
      .from("approval_requests")
      .insert({
        project_id: projectId,
        decision_type: "content",
        subject_type: "task",
        subject_id: taskId,
        title: "Homepage copy",
        requested_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`approval request: ${error?.message}`);
    await adminClient.from("tasks").update({ pending_client_approval: true }).eq("id", taskId);
    return data.id as string;
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: `f009-decide-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    const coClientUser = await makeUser("coclient");
    ownerId = owner.id;
    clientId = clientUser.id;
    clientEmail = clientUser.email;
    coClientId = coClientUser.id;
    coClientEmail = coClientUser.email;

    const { data: workspace, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F009 decide test", slug: `f009-decide-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: coClientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F009 project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
    projectId = project.id;

    await adminClient.from("project_members").insert([
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectId, user_id: coClientId, project_role: "member", added_by: ownerId },
    ]);

    const { data: task, error: taskError } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Homepage copy",
        status: "todo",
        author_id: ownerId,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`task: ${taskError?.message}`);
    taskId = task.id;

    await adminClient.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "content",
      user_id: clientId,
    });
  }, 60_000);

  afterAll(async () => {
    if (!adminClient) return;
    await adminClient.from("approval_requests").delete().eq("project_id", projectId);
    await adminClient.from("project_decision_owners").delete().eq("project_id", projectId);
    await adminClient.from("tasks").delete().eq("project_id", projectId);
    await adminClient.from("projects").delete().eq("id", projectId);
    await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await adminClient.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await adminClient.auth.admin.deleteUser(id);
  }, 60_000);

  it("test_AS_023_primary_success_the_owner_approves_and_the_task_flag_clears", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(clientEmail);

    const { decideApproval } = await import("@/lib/actions/portal-approval");
    const result = await decideApproval(requestId, "approved");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.requestId).toBe(requestId);
    expect(result.data.state).toBe("approved");
    expect(result.data.decidedAt).toBeTruthy();

    const { data: row } = await adminClient
      .from("approval_requests")
      .select("state, decided_by, decided_at")
      .eq("id", requestId)
      .single();
    expect(row?.state).toBe("approved");
    expect(row?.decided_by).toBe(clientId);
    expect(row?.decided_at).toBeTruthy();

    const { data: task } = await adminClient
      .from("tasks")
      .select("pending_client_approval")
      .eq("id", taskId)
      .single();
    expect(task?.pending_client_approval).toBe(false);
  });

  it("test_AS_022_failure_a_non_owner_calling_the_action_is_rejected_and_no_row_changes", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(coClientEmail);

    const { decideApproval } = await import("@/lib/actions/portal-approval");
    const result = await decideApproval(requestId, "approved");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not the decision owner/i);

    const { data: row } = await adminClient
      .from("approval_requests")
      .select("state, decided_by")
      .eq("id", requestId)
      .single();
    expect(row?.state).toBe("pending");
    expect(row?.decided_by).toBeNull();
  });

  it("test_AS_023_request_changes_requires_a_note_and_is_rejected_client_side_without_a_round_trip", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(clientEmail);

    const { decideApproval } = await import("@/lib/actions/portal-approval");
    const result = await decideApproval(requestId, "changes_requested", "   ");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/describe what needs to change/i);

    const { data: row } = await adminClient
      .from("approval_requests")
      .select("state")
      .eq("id", requestId)
      .single();
    expect(row?.state).toBe("pending");
  });

  // --- AS-021 / AS-026: the read queries this feature's page wires up ---

  it("test_AS_021_getOpenApprovalsForClient_returns_the_open_card_with_what_and_due_date", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(clientEmail);

    const { getOpenApprovalsForClient } = await import("@/lib/queries/approvals");
    const open = await getOpenApprovalsForClient(projectId);

    const row = open.find((approval) => approval.id === requestId);
    expect(row).toBeTruthy();
    expect(row?.title).toBe("Homepage copy");
    expect(row?.decisionType).toBe("content");
    expect(row?.state).toBe("pending");
  });

  it("test_AS_026_getApprovalHistory_shows_who_decided_and_when_after_a_decision", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(clientEmail);

    const { decideApproval } = await import("@/lib/actions/portal-approval");
    const decision = await decideApproval(requestId, "approved");
    expect(decision.ok).toBe(true);

    const { getApprovalHistory } = await import("@/lib/queries/approvals");
    const history = await getApprovalHistory(projectId);

    const entry = history.find((row) => row.id === requestId);
    expect(entry).toBeTruthy();
    expect(entry?.state).toBe("approved");
    expect(entry?.decidedByName).toBeTruthy();
    expect(entry?.decidedAt).toBeTruthy();
  });
});
