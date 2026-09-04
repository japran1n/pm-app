// Integration test for F090 item 3: `nudgeApprovalOwner`
// (lib/actions/portal-approval.ts), the replacement for approval-card.tsx's
// old `mailto:` link. Same real-signed-in-session, mocked-`createClient`-
// only pattern as tests/integration/f009-decide-approval-action.test.ts.
//
// Covers: a non-owner client can nudge the real, current decision owner
// (a real in-app notification row is created, kind `approval_owner_nudge`
// -- proving the widened `notifications_kind_check` constraint from
// 20261029010000_f090_approval_owner_nudge_kind.sql actually accepts it
// against the real hosted project, not just as SQL text); the owner
// themselves cannot nudge themselves; a request with no assigned owner
// is rejected with an honest message; the notification's recipient is
// re-derived server-side from `project_decision_owners`, never trusted
// from the caller.

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
    "F090: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveCreds)("F090 item 3 nudgeApprovalOwner", () => {
  let adminClient: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string; // the 'content' decision owner
  let clientId: string; // a client member, NOT the decision owner
  let taskId: string;
  let ownerEmail: string;
  let clientEmail: string;

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
    return data.id as string;
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: `f090-nudge-${label}-${suffix}@example.com`,
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
    ownerEmail = owner.email;
    clientId = clientUser.id;
    clientEmail = clientUser.email;

    const { data: workspace, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F090 nudge test", slug: `f090-nudge-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F090 nudge project",
        visibility: "workspace",
        created_by: clientId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
    projectId = project.id;

    await adminClient.from("project_members").insert([
      { project_id: projectId, user_id: ownerId, project_role: "member", added_by: clientId },
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: clientId },
    ]);

    const { data: task, error: taskError } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Homepage copy",
        status: "todo",
        author_id: clientId,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`task: ${taskError?.message}`);
    taskId = task.id;

    await adminClient.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "content",
      user_id: ownerId,
    });
  }, 60_000);

  afterAll(async () => {
    if (!adminClient) return;
    await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
    await adminClient.from("approval_requests").delete().eq("project_id", projectId);
    await adminClient.from("project_decision_owners").delete().eq("project_id", projectId);
    await adminClient.from("tasks").delete().eq("project_id", projectId);
    await adminClient.from("projects").delete().eq("id", projectId);
    await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await adminClient.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await adminClient.auth.admin.deleteUser(id);
  }, 60_000);

  it("test_AS_090_3_non_owner_can_nudge_the_real_decision_owner_via_a_real_notification", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(clientEmail);

    const { nudgeApprovalOwner } = await import("@/lib/actions/portal-approval");
    const result = await nudgeApprovalOwner(requestId);

    expect(result.ok).toBe(true);

    const { data: notifications, error } = await adminClient
      .from("notifications")
      .select("user_id, kind, workspace_id, payload")
      .eq("workspace_id", workspaceId)
      .eq("kind", "approval_owner_nudge");

    expect(error).toBeNull();
    expect(notifications).toHaveLength(1);
    expect(notifications![0]!.user_id).toBe(ownerId);
    expect((notifications![0]!.payload as { approvalRequestId?: string })?.approvalRequestId).toBe(
      requestId,
    );
  });

  it("test_AS_090_3_the_owner_cannot_nudge_themselves", async () => {
    const requestId = await insertPendingRequest();
    await signInAs(ownerEmail);

    const { nudgeApprovalOwner } = await import("@/lib/actions/portal-approval");
    const result = await nudgeApprovalOwner(requestId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/decision owner/i);
  });

  it("test_AS_090_3_no_owner_assigned_is_rejected_with_an_honest_message_no_notification_sent", async () => {
    await adminClient.from("project_decision_owners").delete().eq("project_id", projectId);

    const requestId = await insertPendingRequest();
    await signInAs(clientEmail);

    const { nudgeApprovalOwner } = await import("@/lib/actions/portal-approval");
    const result = await nudgeApprovalOwner(requestId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no one is assigned/i);

    // Restore for any later test in this file.
    await adminClient.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "content",
      user_id: ownerId,
    });
  });
});
