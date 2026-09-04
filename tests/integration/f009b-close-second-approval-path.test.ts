// Integration test for F009b (missions/20260903-portal, M2 remediation):
// closes the second, ungated client decision path AS-022 requires be
// closed on both surfaces. The M2 gate's exact finding: a client who owns
// no decision type is refused with 42501 on the Approvals view
// (`decide_approval_atomic`) and succeeds on the task page
// (`approve_portal_task_atomic`, which called
// `assert_portal_task_actionable_by_client`, which had no decision-owner
// check at all). Both RPCs are called DIRECTLY here (not through the
// Server Action wrappers other suites already cover), as four callers —
// the decision owner, a client who owns nothing, a client of another
// project, and a client of a portal-disabled project — against every
// path, matching the spec's own scope item 4.
//
// Also covers the two other items from the same gate: `subject_id` is
// validated in the database (a cross-project subject is rejected by
// `decide_approval_atomic` itself, not only by TypeScript), and
// `requestApproval` refuses to raise an approval into a portal-disabled
// project.

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
    "F009b: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";
const RLS_DENIED = "42501";
// assert_portal_task_actionable_by_client's rejections carry no explicit
// errcode (see the in-test comment where this is first used), so
// Postgres's own uncaught-exception default applies.
const TASK_NOT_FOUND = "P0001";

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

describe.skipIf(!haveCreds)("F009b — one gated approval path, database-validated subjects (AS-022)", () => {
  let admin: SupabaseClient;

  let workspaceId: string;
  let ownerId: string;
  let ownerEmail: string;

  let projectId: string; // portal-enabled, has a 'content' owner
  let otherProjectId: string; // a second, portal-enabled project (for the cross-project subject + cross-project caller cases)
  let disabledProjectId: string; // portal-disabled project

  let taskId: string; // client-visible, pending, in projectId
  let otherProjectTaskId: string; // client-visible task in otherProjectId — used as the cross-project subject
  let disabledProjectTaskId: string; // client-visible, pending, in disabledProjectId

  let ownerClientId: string; // owns 'content' in projectId
  let ownerClientEmail: string;
  let nobodyClientId: string; // member of projectId, owns nothing
  let nobodyClientEmail: string;
  let otherProjectClientId: string; // member only of otherProjectId, not projectId
  let otherProjectClientEmail: string;
  let disabledProjectClientId: string; // member of disabledProjectId, owns 'content' there
  let disabledProjectClientEmail: string;

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

  async function insertPendingRequest(pid: string, subjectTaskId: string) {
    const { data, error } = await admin
      .from("approval_requests")
      .insert({
        project_id: pid,
        decision_type: "content",
        subject_type: "task",
        subject_id: subjectTaskId,
        title: "Homepage copy",
        requested_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`approval request: ${error?.message}`);
    return data.id as string;
  }

  async function setPending(tid: string) {
    await admin.from("tasks").update({ pending_client_approval: true }).eq("id", tid);
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f009b-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    ownerId = owner.id;
    ownerEmail = owner.email;

    const ownerClient = await makeUser("owner-client");
    ownerClientId = ownerClient.id;
    ownerClientEmail = ownerClient.email;

    const nobodyClient = await makeUser("nobody-client");
    nobodyClientId = nobodyClient.id;
    nobodyClientEmail = nobodyClient.email;

    const otherProjectClient = await makeUser("other-project-client");
    otherProjectClientId = otherProjectClient.id;
    otherProjectClientEmail = otherProjectClient.email;

    const disabledProjectClient = await makeUser("disabled-project-client");
    disabledProjectClientId = disabledProjectClient.id;
    disabledProjectClientEmail = disabledProjectClient.email;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F009b test", slug: `f009b-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: ownerClientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: nobodyClientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: otherProjectClientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: disabledProjectClientId, role: "client", status: "active" },
    ]);

    const mkProject = async (name: string, portalEnabled: boolean) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: portalEnabled,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectId = await mkProject("F009b project", true);
    otherProjectId = await mkProject("F009b other project", true);
    disabledProjectId = await mkProject("F009b disabled project", false);

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: ownerClientId, project_role: "member", added_by: ownerId },
      { project_id: projectId, user_id: nobodyClientId, project_role: "member", added_by: ownerId },
      { project_id: otherProjectId, user_id: otherProjectClientId, project_role: "member", added_by: ownerId },
      { project_id: disabledProjectId, user_id: disabledProjectClientId, project_role: "member", added_by: ownerId },
    ]);

    const mkTask = async (pid: string, title: string) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: pid,
          title,
          status: "todo",
          author_id: ownerId,
          client_visible: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
      return data.id as string;
    };

    taskId = await mkTask(projectId, "Homepage copy");
    otherProjectTaskId = await mkTask(otherProjectId, "Other project task");
    disabledProjectTaskId = await mkTask(disabledProjectId, "Disabled project task");

    await admin.from("project_decision_owners").insert([
      { project_id: projectId, decision_type: "content", user_id: ownerClientId },
      { project_id: disabledProjectId, decision_type: "content", user_id: disabledProjectClientId },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    for (const pid of [projectId, otherProjectId, disabledProjectId]) {
      await admin.from("approval_requests").delete().eq("project_id", pid);
      await admin.from("project_decision_owners").delete().eq("project_id", pid);
      await admin.from("tasks").delete().eq("project_id", pid);
      await admin.from("projects").delete().eq("id", pid);
    }
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // -----------------------------------------------------------------
  // Surface 1: the Approvals view path — decide_approval_atomic, called
  // directly (not via decideApproval, already covered by f009).
  // -----------------------------------------------------------------

  describe("decide_approval_atomic — every caller", () => {
    it("test_AS_022_decide_approval_atomic_decision_owner_succeeds", async () => {
      const requestId = await insertPendingRequest(projectId, taskId);
      const session = await signInAs(ownerClientEmail);

      const { error } = await session.rpc("decide_approval_atomic", {
        p_request_id: requestId,
        p_decision: "approved",
      });

      expect(error).toBeNull();
    });

    it("test_AS_022_decide_approval_atomic_client_who_owns_nothing_is_rejected", async () => {
      const requestId = await insertPendingRequest(projectId, taskId);
      const session = await signInAs(nobodyClientEmail);

      const { error } = await session.rpc("decide_approval_atomic", {
        p_request_id: requestId,
        p_decision: "approved",
      });

      expect(error?.code).toBe(RLS_DENIED);
      expect(error?.message).toMatch(/not the decision owner/i);
    });

    it("test_AS_022_decide_approval_atomic_client_of_another_project_is_rejected", async () => {
      const requestId = await insertPendingRequest(projectId, taskId);
      const session = await signInAs(otherProjectClientEmail);

      const { error } = await session.rpc("decide_approval_atomic", {
        p_request_id: requestId,
        p_decision: "approved",
      });

      expect(error?.code).toBe(RLS_DENIED);
    });

    it("test_AS_022_decide_approval_atomic_client_of_portal_disabled_project_is_rejected_on_own_project", async () => {
      await setPending(disabledProjectTaskId);
      const requestId = await insertPendingRequest(disabledProjectId, disabledProjectTaskId);
      const session = await signInAs(disabledProjectClientEmail);

      const { error } = await session.rpc("decide_approval_atomic", {
        p_request_id: requestId,
        p_decision: "approved",
      });

      expect(error?.code).toBe(RLS_DENIED);
      expect(error?.message).toMatch(/not the decision owner/i);
    });
  });

  // -----------------------------------------------------------------
  // Surface 2: the task page path — approve_portal_task_atomic, called
  // directly. This is the exact RPC the M2 gate found had no
  // decision-owner check at all.
  // -----------------------------------------------------------------

  describe("approve_portal_task_atomic — every caller", () => {
    it("test_AS_022_approve_portal_task_atomic_decision_owner_succeeds", async () => {
      await setPending(taskId);
      const session = await signInAs(ownerClientEmail);

      const { error } = await session.rpc("approve_portal_task_atomic", { p_task_id: taskId });

      expect(error).toBeNull();
      const { data: row } = await admin
        .from("tasks")
        .select("pending_client_approval")
        .eq("id", taskId)
        .single();
      expect(row?.pending_client_approval).toBe(false);
    });

    it("test_AS_022_approve_portal_task_atomic_client_who_owns_nothing_is_rejected", async () => {
      await setPending(taskId);
      const session = await signInAs(nobodyClientEmail);

      const { error } = await session.rpc("approve_portal_task_atomic", { p_task_id: taskId });

      // F009d (20261021010000) split the "owns no decision type" branch
      // out of the shared "task not found" oracle: by the time this
      // check runs, the caller has already proven membership, project
      // visibility, portal-enabled, and pending state (the Approve
      // button is already on their screen), so naming this refusal with
      // its own errcode/message leaks nothing new. It now raises 42501
      // (insufficient_privilege) with an explicit "no one is assigned to
      // decide this yet" message, matching the Approvals-view path's own
      // RLS_DENIED code for the identical "owns nothing" situation. The
      // other four branches of that function (deleted/non-member,
      // invisible-or-portal-off, not-pending) are untouched and still
      // raise the oracle-neutral 'task not found' at P0001 -- see the
      // "of another project" / "portal disabled" cases below.
      expect(error?.code).toBe(RLS_DENIED);
      expect(error?.message).toMatch(/no one is assigned to decide this yet/i);

      const { data: row } = await admin
        .from("tasks")
        .select("pending_client_approval")
        .eq("id", taskId)
        .single();
      expect(row?.pending_client_approval).toBe(true);
    });

    it("test_AS_022_approve_portal_task_atomic_client_of_another_project_is_rejected", async () => {
      await setPending(taskId);
      const session = await signInAs(otherProjectClientEmail);

      const { error } = await session.rpc("approve_portal_task_atomic", { p_task_id: taskId });

      expect(error?.code).toBe(TASK_NOT_FOUND);
    });

    it("test_AS_022_approve_portal_task_atomic_client_of_portal_disabled_project_is_rejected", async () => {
      await setPending(disabledProjectTaskId);
      const session = await signInAs(disabledProjectClientEmail);

      const { error } = await session.rpc("approve_portal_task_atomic", {
        p_task_id: disabledProjectTaskId,
      });

      expect(error?.code).toBe(TASK_NOT_FOUND);
      expect(error?.message).toMatch(/task not found/i);
    });

    it("test_AS_022_request_portal_task_changes_atomic_client_who_owns_nothing_is_rejected", async () => {
      await setPending(taskId);
      const session = await signInAs(nobodyClientEmail);

      const { error } = await session.rpc("request_portal_task_changes_atomic", { p_task_id: taskId });

      // Same F009d split as the approve_portal_task_atomic case above --
      // both RPCs share assert_portal_task_actionable_by_client.
      expect(error?.code).toBe(RLS_DENIED);
      expect(error?.message).toMatch(/no one is assigned to decide this yet/i);
    });
  });

  // -----------------------------------------------------------------
  // Failure test (definition of done): the decision owner still
  // succeeds on both surfaces, and the legacy toggle still works for
  // what it is for — covered by the two "decision_owner_succeeds" cases
  // above. This block adds the explicit "both surfaces agree" pairing.
  // -----------------------------------------------------------------

  it("test_AS_022_both_surfaces_agree_a_non_owner_is_refused_on_both", async () => {
    await setPending(taskId);
    const requestId = await insertPendingRequest(projectId, taskId);

    const session = await signInAs(nobodyClientEmail);

    const approvalsViewResult = await session.rpc("decide_approval_atomic", {
      p_request_id: requestId,
      p_decision: "approved",
    });
    const taskPageResult = await session.rpc("approve_portal_task_atomic", { p_task_id: taskId });

    // Both surfaces now agree on the errcode too, not just the refusal
    // itself: F009d (20261021010000) named this one branch of
    // assert_portal_task_actionable_by_client with the same 42501 that
    // decide_approval_atomic already used, so a non-owner is refused
    // identically on both the Approvals view and the legacy task page.
    expect(approvalsViewResult.error?.code).toBe(RLS_DENIED);
    expect(taskPageResult.error?.code).toBe(RLS_DENIED);
  });

  // -----------------------------------------------------------------
  // subject_id validated in the database (F-1): a mismatched subject is
  // rejected by decide_approval_atomic itself, not only by the Zod
  // schema in lib/validation/approvals.ts.
  // -----------------------------------------------------------------

  it("test_AS_022_subject_id_cross_project_mismatch_is_rejected_by_the_rpc_itself", async () => {
    // A request raised on projectId whose subject_id actually belongs to
    // otherProjectId — schema-legal (no FK, no cross-table CHECK), only
    // reachable via a raw insert (same as F-1 describes: "a team writer
    // posting directly to PostgREST").
    const requestId = await insertPendingRequest(projectId, otherProjectTaskId);

    const session = await signInAs(ownerClientEmail);
    const { error } = await session.rpc("decide_approval_atomic", {
      p_request_id: requestId,
      p_decision: "approved",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("P0002");

    const { data: row } = await admin
      .from("approval_requests")
      .select("state")
      .eq("id", requestId)
      .single();
    expect(row?.state).toBe("pending");

    // The mismatched subject's own comment/flag state must be untouched.
    const { data: otherTask } = await admin
      .from("tasks")
      .select("pending_client_approval")
      .eq("id", otherProjectTaskId)
      .single();
    expect(otherTask?.pending_client_approval).toBe(false);
  });

  // -----------------------------------------------------------------
  // requestApproval refuses to raise into a portal-disabled project
  // (F-2), same "sent into a void" reasoning the missing-owner check
  // already uses.
  // -----------------------------------------------------------------

  it("test_AS_022_requestApproval_refuses_a_portal_disabled_project", async () => {
    await signInAs(ownerEmail);

    const { requestApproval } = await import("@/lib/actions/approvals");
    const result = await requestApproval({
      projectId: disabledProjectId,
      subjectType: "task",
      subjectId: disabledProjectTaskId,
      decisionType: "content",
      title: "Should never be raised",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/portal/i);

    const { data: rows } = await admin
      .from("approval_requests")
      .select("id")
      .eq("project_id", disabledProjectId)
      .eq("title", "Should never be raised");
    expect(rows ?? []).toHaveLength(0);
  });
});
