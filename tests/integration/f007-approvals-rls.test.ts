// Integration test for F007 (missions/20260903-portal, M2 — Approvals):
// `approval_requests`, `project_decision_owners`, and
// `decide_approval_atomic`. Covers AS-019, AS-020, AS-022, AS-023, AS-024.
//
// Driven through real signed-in sessions and PostgREST/`.rpc()`, matching
// this suite's established convention (tests/integration/
// portal-phases-rls.test.ts, tests/integration/overdue-count-rpc.test.ts)
// — the point is exercising the policies, the trigger, and the RPC
// themselves, not a mocked query builder. No test here mocks the function
// it is asserting about.

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
const RLS_DENIED = "42501";

describe.skipIf(!haveCreds)("approval_requests / project_decision_owners / decide_approval_atomic", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient; // the named decision owner
  let coClientSession: SupabaseClient; // a client, but NOT the decision owner

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;
  let coClientId: string;

  let visibleTaskId: string;
  let hiddenTaskId: string;
  let docId: string;

  const createdUserIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f007-approvals-${label}-${suffix}@example.com`,
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
    const coClientUser = await makeUser("coclient");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;
    coClientId = coClientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F007 approvals test", slug: `f007-approvals-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: coClientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string, portalEnabled: boolean) => {
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

    enabledProjectId = await insertProject("Portal on", true);
    disabledProjectId = await insertProject("Portal off", false);

    await admin.from("project_members").insert([
      { project_id: enabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: enabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: enabledProjectId, user_id: coClientId, project_role: "member", added_by: ownerId },
      { project_id: disabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const insertTask = async (projectId: string, title: string, clientVisible: boolean) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({ project_id: projectId, title, status: "todo", author_id: ownerId, client_visible: clientVisible })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
      return data.id as string;
    };

    visibleTaskId = await insertTask(enabledProjectId, "Homepage moodboard", true);
    hiddenTaskId = await insertTask(enabledProjectId, "Internal: pricing negotiation notes", false);

    const { data: doc, error: docError } = await admin
      .from("docs")
      .insert({ workspace_id: workspaceId, project_id: enabledProjectId, title: "Sitemap v1", created_by: ownerId })
      .select("id")
      .single();
    if (docError || !doc) throw new Error(`doc: ${docError?.message}`);
    docId = doc.id;

    // The client (not a team member) is the named decision owner for
    // 'content' on the enabled project — the realistic Good Guys shape
    // (a client decides; a team member never should be able to, even the
    // one who raised the request).
    await admin.from("project_decision_owners").insert({
      project_id: enabledProjectId,
      decision_type: "content",
      user_id: clientId,
    });

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
    coClientSession = await signIn(coClientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("approval_requests").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_decision_owners").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("docs").delete().eq("workspace_id", workspaceId);
    await admin.from("tasks").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_members").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // --- AS-019: a team member can create from a task, a doc, or standalone
  // with an artifact URL -------------------------------------------------

  describe("AS-019: a team member can create an approval request from a task, a doc, or an artifact URL", () => {
    it("from a task", async () => {
      const { data, error } = await memberSession
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "task",
          subject_id: visibleTaskId,
          title: "Approve homepage moodboard",
          decision_type: "content",
          requested_by: memberId,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      createdRequestIds.push(data!.id);
    });

    it("from a doc", async () => {
      const { data, error } = await memberSession
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "doc",
          subject_id: docId,
          title: "Approve sitemap",
          decision_type: "content",
          requested_by: memberId,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      createdRequestIds.push(data!.id);
    });

    it("standalone, with an external artifact URL", async () => {
      const { data, error } = await memberSession
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "artifact",
          artifact_url: "https://www.figma.com/file/abc123/moodboard",
          title: "Approve Figma moodboard",
          decision_type: "brand",
          requested_by: memberId,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      createdRequestIds.push(data!.id);
    });

    it("a viewer/guest-equivalent write is blocked: the row must carry subject_id (task/doc/phase) or artifact_url (artifact) — the CHECK constraint rejects neither being set", async () => {
      const { error } = await admin.from("approval_requests").insert({
        project_id: enabledProjectId,
        subject_type: "artifact",
        title: "Missing artifact_url",
        decision_type: "brand",
        requested_by: memberId,
      });
      expect(error).not.toBeNull();
    });

    it("the CHECK constraint also rejects a task/doc/phase subject with no subject_id", async () => {
      const { error } = await admin.from("approval_requests").insert({
        project_id: enabledProjectId,
        subject_type: "task",
        title: "Missing subject_id",
        decision_type: "content",
        requested_by: memberId,
      });
      expect(error).not.toBeNull();
    });
  });

  // --- AS-020: rejected at creation time when the subject task is not
  // client-visible --------------------------------------------------------

  it("AS-020: creating an approval request against a task that is not client-visible is rejected at creation time with an explicit error", async () => {
    const { data, error } = await memberSession
      .from("approval_requests")
      .insert({
        project_id: enabledProjectId,
        subject_type: "task",
        subject_id: hiddenTaskId,
        title: "Approve the internal pricing notes (should never be allowed)",
        decision_type: "content",
        requested_by: memberId,
      })
      .select("id")
      .single();

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  // --- Read-side leak test (Definition of done, failure test (c)): an
  // approval whose subject task is not client-visible is invisible to the
  // client, title included -------------------------------------------------

  describe("a client_visible=false subject task's approval never leaks to a client, title included", () => {
    let hiddenSubjectRequestId: string;

    beforeAll(async () => {
      // Inserted via the admin client (bypassing the AS-020 INSERT gate
      // above on purpose) to prove the READ side is independently
      // defended, not merely a consequence of the write-time gate always
      // having been enforced — e.g. a task that was client-visible when
      // the approval was raised and was un-shared afterward.
      const { data, error } = await admin
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "task",
          subject_id: hiddenTaskId,
          title: "Internal: pricing negotiation notes -- must never reach the client",
          decision_type: "content",
          requested_by: memberId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`hidden-subject approval: ${error?.message}`);
      hiddenSubjectRequestId = data.id;
      createdRequestIds.push(hiddenSubjectRequestId);
    });

    it("is invisible to the client via a direct id lookup (title never reaches the client)", async () => {
      const { data, error } = await clientSession
        .from("approval_requests")
        .select("id, title")
        .eq("id", hiddenSubjectRequestId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("is invisible to the client via a project-scoped list, too", async () => {
      const { data, error } = await clientSession
        .from("approval_requests")
        .select("id")
        .eq("project_id", enabledProjectId);
      expect(error).toBeNull();
      expect(data?.map((r) => r.id)).not.toContain(hiddenSubjectRequestId);
    });

    it("regression: a team member still sees it", async () => {
      const { data, error } = await memberSession
        .from("approval_requests")
        .select("id")
        .eq("id", hiddenSubjectRequestId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  // --- portal_enabled gate on approval_requests / project_decision_owners

  describe("a portal-disabled project's approvals and decision owners are invisible to its client", () => {
    let disabledProjectVisibleTaskId: string;
    let disabledProjectRequestId: string;

    beforeAll(async () => {
      const { data: task, error: taskError } = await admin
        .from("tasks")
        .insert({ project_id: disabledProjectId, title: "Shared task, portal off", status: "todo", author_id: ownerId, client_visible: true })
        .select("id")
        .single();
      if (taskError || !task) throw new Error(`task: ${taskError?.message}`);
      disabledProjectVisibleTaskId = task.id;

      await admin.from("project_decision_owners").insert({
        project_id: disabledProjectId,
        decision_type: "content",
        user_id: clientId,
      });

      const { data: request, error: requestError } = await admin
        .from("approval_requests")
        .insert({
          project_id: disabledProjectId,
          subject_type: "task",
          subject_id: disabledProjectVisibleTaskId,
          title: "Approve this (portal is off)",
          decision_type: "content",
          requested_by: memberId,
        })
        .select("id")
        .single();
      if (requestError || !request) throw new Error(`request: ${requestError?.message}`);
      disabledProjectRequestId = request.id;
    });

    it("approval_requests: client sees none", async () => {
      const { data, error } = await clientSession
        .from("approval_requests")
        .select("id")
        .eq("project_id", disabledProjectId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("project_decision_owners: client sees none", async () => {
      const { data, error } = await clientSession
        .from("project_decision_owners")
        .select("id")
        .eq("project_id", disabledProjectId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("regression: a team member still sees both", async () => {
      const { data: requests, error: requestsError } = await memberSession
        .from("approval_requests")
        .select("id")
        .eq("id", disabledProjectRequestId);
      expect(requestsError).toBeNull();
      expect(requests).toHaveLength(1);

      const { data: owners, error: ownersError } = await memberSession
        .from("project_decision_owners")
        .select("id")
        .eq("project_id", disabledProjectId);
      expect(ownersError).toBeNull();
      expect(owners).toHaveLength(1);
    });
  });

  // --- project_decision_owners: portal-enabled project, client can read

  it("project_decision_owners: a client of a portal-enabled project reads the 'who approves what' row", async () => {
    const { data, error } = await clientSession
      .from("project_decision_owners")
      .select("decision_type, user_id")
      .eq("project_id", enabledProjectId);
    expect(error).toBeNull();
    expect(data).toEqual([{ decision_type: "content", user_id: clientId }]);
  });

  it("a client cannot write to project_decision_owners", async () => {
    const { error } = await clientSession.from("project_decision_owners").insert({
      project_id: enabledProjectId,
      decision_type: "technical",
      user_id: clientId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("a client cannot UPDATE approval_requests directly — decisions go only through the RPC", async () => {
    const { data: created, error: createError } = await admin
      .from("approval_requests")
      .insert({
        project_id: enabledProjectId,
        subject_type: "task",
        subject_id: visibleTaskId,
        title: "Direct-update probe",
        decision_type: "content",
        requested_by: memberId,
      })
      .select("id")
      .single();
    expect(createError).toBeNull();
    createdRequestIds.push(created!.id);

    // A client has no UPDATE policy on approval_requests at all, so
    // Postgres's RLS simply filters the row set to update down to zero —
    // the request itself does not error (matching the exact
    // "PostgREST returns 0 rows updated, no error" shape this schema's
    // own approve_portal_task_atomic migration documents for the
    // identical "role has no matching UPDATE policy" case), but no row is
    // actually changed, verified below via the admin client.
    const { data: updated, error } = await clientSession
      .from("approval_requests")
      .update({ state: "approved" })
      .eq("id", created!.id)
      .select("id");
    expect(error).toBeNull();
    expect(updated).toEqual([]);

    const { data: unchanged } = await admin
      .from("approval_requests")
      .select("state")
      .eq("id", created!.id)
      .single();
    expect(unchanged?.state).toBe("pending");
  });

  it("AS-022 regression: a team member (a project writer, not the decision owner) cannot self-approve via a direct UPDATE either -- only decide_approval_atomic can settle a request", async () => {
    const { data: created, error: createError } = await admin
      .from("approval_requests")
      .insert({
        project_id: enabledProjectId,
        subject_type: "task",
        subject_id: visibleTaskId,
        title: "Team self-approve probe",
        decision_type: "content",
        requested_by: memberId,
      })
      .select("id")
      .single();
    expect(createError).toBeNull();
    createdRequestIds.push(created!.id);

    // memberSession DOES have an UPDATE policy on this row (they are a
    // project writer) -- the USING clause lets Postgres find the row, but
    // the policy's own WITH CHECK forbids the row from leaving 'pending'
    // or carrying a decision, so this specific write is rejected with an
    // explicit RLS violation (not a silent zero-rows no-op, because the
    // row WAS matched -- it's the resulting row shape that's rejected).
    const { data: updated, error } = await memberSession
      .from("approval_requests")
      .update({ state: "approved", decided_by: memberId, decided_at: new Date().toISOString() })
      .eq("id", created!.id)
      .select("id");
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
    expect(updated).toBeNull();

    const { data: unchanged } = await admin
      .from("approval_requests")
      .select("state, decided_by")
      .eq("id", created!.id)
      .single();
    expect(unchanged?.state).toBe("pending");
    expect(unchanged?.decided_by).toBeNull();

    // The same team member CAN still edit ordinary metadata on the same
    // pending row -- the policy narrows what a team UPDATE can settle,
    // not whether a team member can update the row at all.
    const { error: metadataError } = await memberSession
      .from("approval_requests")
      .update({ description: "Updated description while still pending" })
      .eq("id", created!.id);
    expect(metadataError).toBeNull();
  });

  // --- decide_approval_atomic --------------------------------------------

  describe("decide_approval_atomic", () => {
    let pendingRequestId: string;

    beforeAll(async () => {
      // Flag the task as pending-approval first, so the RPC's clearing of
      // it (AS-023) is an observable state change, not a no-op.
      await admin.from("tasks").update({ pending_client_approval: true }).eq("id", visibleTaskId);

      const { data, error } = await admin
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "task",
          subject_id: visibleTaskId,
          title: "Approve homepage moodboard (RPC test)",
          decision_type: "content",
          requested_by: memberId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`pending request: ${error?.message}`);
      pendingRequestId = data.id;
      createdRequestIds.push(pendingRequestId);
    });

    it("AS-022: a team member (not the named decision owner) cannot record a decision, even though they raised the request", async () => {
      const { data, error } = await memberSession.rpc("decide_approval_atomic", {
        p_request_id: pendingRequestId,
        p_decision: "approved",
        p_note: null,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();

      const { data: stillPending } = await admin
        .from("approval_requests")
        .select("state")
        .eq("id", pendingRequestId)
        .single();
      expect(stillPending?.state).toBe("pending");
    });

    it("AS-022: a client who is NOT the named decision owner cannot record a decision, enforced server-side (called directly, not through any UI)", async () => {
      const { data, error } = await coClientSession.rpc("decide_approval_atomic", {
        p_request_id: pendingRequestId,
        p_decision: "approved",
        p_note: null,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();

      const { data: stillPending } = await admin
        .from("approval_requests")
        .select("state")
        .eq("id", pendingRequestId)
        .single();
      expect(stillPending?.state).toBe("pending");
    });

    it("rejects 'changes_requested' with an empty note", async () => {
      const { data, error } = await clientSession.rpc("decide_approval_atomic", {
        p_request_id: pendingRequestId,
        p_decision: "changes_requested",
        p_note: "   ",
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("AS-023: the named decision owner approves — decider, timestamp, and decision are recorded, and the linked task's pending-approval flag clears, all in one call", async () => {
      const before = new Date();
      const { data, error } = await clientSession.rpc("decide_approval_atomic", {
        p_request_id: pendingRequestId,
        p_decision: "approved",
        p_note: "Looks great, ship it.",
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].state).toBe("approved");

      const { data: row, error: rowError } = await admin
        .from("approval_requests")
        .select("state, decided_by, decided_at, decision_note")
        .eq("id", pendingRequestId)
        .single();
      expect(rowError).toBeNull();
      expect(row?.state).toBe("approved");
      expect(row?.decided_by).toBe(clientId);
      expect(row?.decision_note).toBe("Looks great, ship it.");
      expect(row?.decided_at).toBeTruthy();
      expect(new Date(row!.decided_at!).getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);

      const { data: task } = await admin
        .from("tasks")
        .select("pending_client_approval")
        .eq("id", visibleTaskId)
        .single();
      expect(task?.pending_client_approval).toBe(false);

      const { data: auditRows } = await admin
        .from("audit_log")
        .select("action, target_type, target_id, actor_id")
        .eq("target_id", pendingRequestId)
        .eq("action", "approval_request.approved");
      expect(auditRows).toHaveLength(1);
      expect(auditRows![0].actor_id).toBe(clientId);
      expect(auditRows![0].target_type).toBe("approval_request");

      const { data: notificationRows } = await admin
        .from("notifications")
        .select("kind, user_id, actor_id, task_id")
        .eq("user_id", memberId)
        .eq("kind", "approval_decided");
      expect(notificationRows?.length).toBeGreaterThanOrEqual(1);
      const notification = notificationRows!.find((n) => n.task_id === visibleTaskId);
      expect(notification).toBeTruthy();
      expect(notification?.actor_id).toBe(clientId);
    });

    it("AS-024: a second decision on the now-settled request is rejected by decide_approval_atomic itself", async () => {
      const { data, error } = await clientSession.rpc("decide_approval_atomic", {
        p_request_id: pendingRequestId,
        p_decision: "changes_requested",
        p_note: "Changed my mind",
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("AS-024: a settled decision cannot be edited by a direct UPDATE either — the trigger blocks it independent of RLS/role, even for the admin client", async () => {
      const { error } = await admin
        .from("approval_requests")
        .update({ decision_note: "edited after the fact" })
        .eq("id", pendingRequestId);
      expect(error).not.toBeNull();

      const { data: row } = await admin
        .from("approval_requests")
        .select("decision_note")
        .eq("id", pendingRequestId)
        .single();
      expect(row?.decision_note).toBe("Looks great, ship it.");
    });

    it("AS-024: a changed mind requires a NEW approval request (supersedes_id), not a resurrection of the old one", async () => {
      const { data: newRequest, error } = await memberSession
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "task",
          subject_id: visibleTaskId,
          title: "Re-approve homepage moodboard (round 2)",
          decision_type: "content",
          requested_by: memberId,
          supersedes_id: pendingRequestId,
          round: 2,
        })
        .select("id, supersedes_id, round, state")
        .single();
      expect(error).toBeNull();
      expect(newRequest?.state).toBe("pending");
      expect(newRequest?.supersedes_id).toBe(pendingRequestId);
      createdRequestIds.push(newRequest!.id);
    });

    it("rejects an unknown request id with an explicit error, not a silent no-op", async () => {
      const { data, error } = await clientSession.rpc("decide_approval_atomic", {
        p_request_id: "00000000-0000-4000-8000-000000000000",
        p_decision: "approved",
        p_note: null,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("rejects an invalid decision value", async () => {
      const { data: freshRequest } = await admin
        .from("approval_requests")
        .insert({
          project_id: enabledProjectId,
          subject_type: "task",
          subject_id: visibleTaskId,
          title: "Invalid-decision probe",
          decision_type: "content",
          requested_by: memberId,
        })
        .select("id")
        .single();
      createdRequestIds.push(freshRequest!.id);

      const { data, error } = await clientSession.rpc("decide_approval_atomic", {
        p_request_id: freshRequest!.id,
        p_decision: "withdrawn",
        p_note: null,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });
  });

  // --- Side-effect verification: approve_portal_task_atomic still works --

  it("side-effect verification: the pre-existing approve_portal_task_atomic (task-boolean path) still works unmodified", async () => {
    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        project_id: enabledProjectId,
        title: "Boolean-only approval path",
        status: "todo",
        author_id: ownerId,
        client_visible: true,
        pending_client_approval: true,
      })
      .select("id")
      .single();
    expect(taskError).toBeNull();

    const { error } = await clientSession.rpc("approve_portal_task_atomic", { p_task_id: task!.id });
    expect(error).toBeNull();

    const { data: after } = await admin
      .from("tasks")
      .select("pending_client_approval")
      .eq("id", task!.id)
      .single();
    expect(after?.pending_client_approval).toBe(false);

    await admin.from("tasks").delete().eq("id", task!.id);
  });
});
