// Integration test for F016 (missions/20260903-portal, M3 — change
// requests: triage, quote, gate). Covers AS-047 ("a change_request cannot
// become a task until the client has approved its quote, enforced inside
// accept_client_request_atomic") end to end: team quotes it
// (send_change_request_quote_atomic), the client decides through F007's
// own approval mechanism (decide_approval_atomic, decision_type =
// 'commercial'), and only then can the team accept it
// (accept_client_request_atomic) — and a project_scope_items row appears.
// Also covers: an expired quote is refused even after approval, and a
// pre-existing accepted request (no scope_verdict at all) is unaffected.
//
// Driven through real signed-in sessions and RPC calls, matching this
// suite's established convention (f012/f014/f015's own integration
// tests) — the point is exercising the RPC's own authorization and gate
// against a real database, not a mocked one.

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

describe.skipIf(!haveCreds)("change request quote gate (AS-047, AS-048)", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;

  const createdUserIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f016-cr-${label}-${suffix}@example.com`,
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
      .insert({ name: "F016 quote gate test", slug: `f016-cr-${suffix}` })
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
        name: "Quote gate project",
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

    // decide_approval_atomic's own AS-022 ownership check: the client
    // decision needs a named 'commercial' decision owner. Use the client
    // themselves — a project's own client is exactly who decides on a
    // commercial quote in this system.
    await admin.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "commercial",
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
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project_scope_items").delete().eq("project_id", projectId);
    await admin.from("approval_requests").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("project_id", projectId);
    await admin.from("client_requests").delete().in("id", createdRequestIds);
    await admin.from("project_decision_owners").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  async function makeRequest(title: string) {
    const { data, error } = await admin
      .from("client_requests")
      .insert({ project_id: projectId, created_by: clientId, title, status: "submitted" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`request: ${error?.message}`);
    createdRequestIds.push(data.id);
    return data.id as string;
  }

  it("test_AS_046_client_cannot_write_quoted_amount_client_decision_or_decided_by_on_their_own_submitted_request", async () => {
    const requestId = await makeRequest("Client tries to write their own quote");

    const { error } = await clientSession
      .from("client_requests")
      .update({
        quoted_amount: 1,
        client_decision: "approved",
        decided_by: clientId,
      })
      .eq("id", requestId);

    expect(error).not.toBeNull();

    const { data: unchanged } = await admin
      .from("client_requests")
      .select("quoted_amount, client_decision, decided_by")
      .eq("id", requestId)
      .single();
    expect(unchanged?.quoted_amount).toBeNull();
    expect(unchanged?.client_decision).toBe("pending");
    expect(unchanged?.decided_by).toBeNull();
  });

  it("test_AS_046_client_can_still_edit_title_and_body_of_their_own_submitted_request", async () => {
    const requestId = await makeRequest("Client edits their own ungated fields");

    const { error } = await clientSession
      .from("client_requests")
      .update({ title: "Client edits their own ungated fields (updated)" })
      .eq("id", requestId);

    expect(error).toBeNull();

    const { data: updated } = await admin
      .from("client_requests")
      .select("title")
      .eq("id", requestId)
      .single();
    expect(updated?.title).toBe("Client edits their own ungated fields (updated)");
  });

  // F016f (M3-scrutiny-2, B2): F016d's column guard was BEFORE UPDATE
  // only — a client could POST a request that arrives already carrying
  // client_decision='approved' or a foreign approval_request_id and
  // defeat AS-047 outright, without ever touching the guarded UPDATE
  // path. The trigger now fires on INSERT too.

  it("test_AS_047_a_client_cannot_insert_a_request_already_carrying_client_decision_approved", async () => {
    const { error } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Pre-approved by me",
      status: "submitted",
      client_decision: "approved",
    });
    expect(error).not.toBeNull();
  });

  it("test_AS_047_a_client_cannot_insert_a_request_already_carrying_a_quoted_amount_or_scope_verdict", async () => {
    const { error } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Pre-quoted by me",
      status: "submitted",
      scope_verdict: "in_scope",
      quoted_amount: 500,
    });
    expect(error).not.toBeNull();
  });

  it("test_AS_047_a_client_cannot_insert_a_request_pointing_approval_request_id_at_an_existing_approval", async () => {
    // A pending commercial approval already exists on this project from
    // an earlier quote (created via the RPC in other tests in this
    // file's project) — but even a fabricated, non-existent id must be
    // rejected identically: the guard fires on the column being non-null
    // at all, not on whether the row it points to exists.
    const { error } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Hijack the sync trigger",
      status: "submitted",
      approval_request_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
  });

  it("test_AS_047_a_client_can_still_file_an_ordinary_request_with_every_guarded_column_left_at_its_default", async () => {
    const { data, error } = await clientSession
      .from("client_requests")
      .insert({
        project_id: projectId,
        created_by: clientId,
        title: "An ordinary request",
        body: "Nothing pre-filled.",
      })
      .select("id, status, client_decision, scope_verdict, quoted_amount, approval_request_id")
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe("submitted");
    expect(data?.client_decision).toBe("pending");
    expect(data?.scope_verdict).toBeNull();
    expect(data?.quoted_amount).toBeNull();
    expect(data?.approval_request_id).toBeNull();
    if (data?.id) createdRequestIds.push(data.id);

    // And the team can still triage and quote it — the guard does not
    // block the legitimate write path.
    const { error: quoteError } = await memberSession.rpc("send_change_request_quote_atomic", {
      p_request_id: data!.id,
      p_scope_verdict: "in_scope",
    });
    expect(quoteError).toBeNull();
  });

  it("cannot be accepted while client_decision = 'pending'; after the client approves through the approval RPC, it can, and a scope item appears", async () => {
    const requestId = await makeRequest("Add a members-only section");

    const { data: quoteRows, error: quoteError } = await memberSession.rpc(
      "send_change_request_quote_atomic",
      {
        p_request_id: requestId,
        p_scope_verdict: "change_request",
        p_quoted_hours: 8,
        p_quoted_amount: 1200,
        p_quote_currency: "USD",
        p_quote_note: "Extra section, extra sprint.",
        p_quote_valid_until: "2099-01-01",
        p_track: "dev_change",
      },
    );
    expect(quoteError).toBeNull();
    const quoteRow = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    const approvalRequestId = quoteRow?.approval_request_id as string;
    expect(approvalRequestId).toBeTruthy();

    // Not yet approved: acceptance is refused, with the gate's own error
    // code, not a generic failure.
    const { error: blockedError } = await memberSession.rpc("accept_client_request_atomic", {
      p_request_id: requestId,
    });
    expect(blockedError).not.toBeNull();
    expect(blockedError?.code).toBe("CR047");

    // The client decides through F007's own mechanism — no second
    // decision path.
    const { error: decideError } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: approvalRequestId,
      p_decision: "approved",
    });
    expect(decideError).toBeNull();

    const { data: afterApproval } = await admin
      .from("client_requests")
      .select("client_decision, decided_by")
      .eq("id", requestId)
      .single();
    expect(afterApproval?.client_decision).toBe("approved");
    expect(afterApproval?.decided_by).toBe(clientId);

    const { data: acceptRows, error: acceptError } = await memberSession.rpc(
      "accept_client_request_atomic",
      { p_request_id: requestId },
    );
    expect(acceptError).toBeNull();
    const acceptRow = Array.isArray(acceptRows) ? acceptRows[0] : acceptRows;
    expect(acceptRow?.task_id).toBeTruthy();

    const { data: scopeItems } = await admin
      .from("project_scope_items")
      .select("id, source, change_request_id, included")
      .eq("change_request_id", requestId);
    expect(scopeItems?.length).toBe(1);
    expect(scopeItems?.[0]?.source).toBe("change_request");
    expect(scopeItems?.[0]?.included).toBe(true);
  });

  it("refuses acceptance of an expired quote even after approval", async () => {
    const requestId = await makeRequest("Rebuild the pricing page");

    const { data: quoteRows } = await memberSession.rpc("send_change_request_quote_atomic", {
      p_request_id: requestId,
      p_scope_verdict: "change_request",
      p_quoted_amount: 500,
      p_quote_valid_until: "2020-01-01", // already in the past
    });
    const quoteRow = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    const approvalRequestId = quoteRow?.approval_request_id as string;

    await clientSession.rpc("decide_approval_atomic", {
      p_request_id: approvalRequestId,
      p_decision: "approved",
    });

    const { data: afterApproval } = await admin
      .from("client_requests")
      .select("client_decision")
      .eq("id", requestId)
      .single();
    expect(afterApproval?.client_decision).toBe("approved");

    const { error: acceptError } = await memberSession.rpc("accept_client_request_atomic", {
      p_request_id: requestId,
    });
    expect(acceptError).not.toBeNull();
    expect(acceptError?.code).toBe("CR048");
  });

  it("leaves a pre-existing accepted request (no scope_verdict) unaffected by the gate", async () => {
    const requestId = await makeRequest("Old plain request");

    // No triage at all -- scope_verdict stays null, exactly like a row
    // that predates this migration.
    const { data: acceptRows, error: acceptError } = await memberSession.rpc(
      "accept_client_request_atomic",
      { p_request_id: requestId },
    );
    expect(acceptError).toBeNull();
    const acceptRow = Array.isArray(acceptRows) ? acceptRows[0] : acceptRows;
    expect(acceptRow?.task_id).toBeTruthy();

    const { data: row } = await admin
      .from("client_requests")
      .select("status, scope_verdict")
      .eq("id", requestId)
      .single();
    expect(row?.status).toBe("accepted");
    expect(row?.scope_verdict).toBeNull();
  });

  it("rejects an accept-attempt by a caller who is not a project writer, independent of the gate", async () => {
    const requestId = await makeRequest("Client cannot self-accept");

    const { error } = await clientSession.rpc("accept_client_request_atomic", {
      p_request_id: requestId,
    });
    expect(error).not.toBeNull();
  });

  // F016e (missions/20260903-portal, M3-scrutiny defect 2, AS-048): the
  // portal's change-request list used to be scoped by
  // `created_by = auth.uid()` -- two people from the same client company
  // each saw only the half of their own project's change requests they
  // personally filed. `client_requests_select_author_or_team` is now
  // project-scoped, the same shape as every other client-facing SELECT
  // policy this mission introduced.
  it("test_AS_048_two_client_users_of_one_project_each_see_all_of_the_projects_change_requests", async () => {
    const requestByFirstClient = await makeRequest("Filed by the first client user");

    const { data: secondClientUser, error: secondClientErr } = await admin.auth.admin.createUser({
      email: `f016-cr-second-client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (secondClientErr || !secondClientUser.user) {
      throw new Error(`second client: ${secondClientErr?.message}`);
    }
    createdUserIds.push(secondClientUser.user.id);

    await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: secondClientUser.user.id,
      role: "client",
      status: "active",
    });
    await admin.from("project_members").insert({
      project_id: projectId,
      user_id: secondClientUser.user.id,
      project_role: "member",
      added_by: ownerId,
    });

    const secondClientSession = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await secondClientSession.auth.signInWithPassword({
      email: secondClientUser.user.email!,
      password: PASSWORD,
    });
    if (signInErr) throw new Error(`sign in second client: ${signInErr.message}`);

    const { data: requestBySecondClient, error: secondRequestErr } = await secondClientSession
      .from("client_requests")
      .insert({ project_id: projectId, created_by: secondClientUser.user.id, title: "Filed by the second client user" })
      .select("id")
      .single();
    if (secondRequestErr || !requestBySecondClient) {
      throw new Error(`second client request: ${secondRequestErr?.message}`);
    }
    createdRequestIds.push(requestBySecondClient.id);

    const { data: seenByFirst, error: firstReadErr } = await clientSession
      .from("client_requests")
      .select("id")
      .eq("project_id", projectId);
    expect(firstReadErr).toBeNull();
    const firstIds = (seenByFirst ?? []).map((r) => r.id);
    expect(firstIds).toContain(requestByFirstClient);
    expect(firstIds).toContain(requestBySecondClient.id);

    const { data: seenBySecond, error: secondReadErr } = await secondClientSession
      .from("client_requests")
      .select("id")
      .eq("project_id", projectId);
    expect(secondReadErr).toBeNull();
    const secondIds = (seenBySecond ?? []).map((r) => r.id);
    expect(secondIds).toContain(requestByFirstClient);
    expect(secondIds).toContain(requestBySecondClient.id);
  });

  // F016e (missions/20260903-portal, M3-scrutiny defect 3): re-quoting
  // used to leave the FIRST approval live -- approving it silently did
  // nothing (the sync trigger only ever reads the CURRENT
  // approval_request_id), and if a client approved both quotes before
  // anyone noticed, each approval independently inserted a
  // project_scope_items row for the same request. This proves both
  // halves of the fix: the prior approval is withdrawn (approving it now
  // fails outright, rather than silently doing nothing), and even if
  // both approvals are pushed through, exactly one scope item survives.
  it("test_re_quoting_withdraws_the_prior_approval_and_produces_exactly_one_live_approval_and_one_scope_item", async () => {
    const requestId = await makeRequest("Re-quoted change request");

    const { data: firstQuoteRows } = await memberSession.rpc("send_change_request_quote_atomic", {
      p_request_id: requestId,
      p_scope_verdict: "change_request",
      p_quoted_amount: 500,
      p_quote_valid_until: "2099-01-01",
    });
    const firstQuote = Array.isArray(firstQuoteRows) ? firstQuoteRows[0] : firstQuoteRows;
    const firstApprovalId = firstQuote?.approval_request_id as string;
    expect(firstApprovalId).toBeTruthy();

    // A second quote, before the client ever decided on the first.
    const { data: secondQuoteRows } = await memberSession.rpc("send_change_request_quote_atomic", {
      p_request_id: requestId,
      p_scope_verdict: "change_request",
      p_quoted_amount: 800,
      p_quote_valid_until: "2099-01-01",
    });
    const secondQuote = Array.isArray(secondQuoteRows) ? secondQuoteRows[0] : secondQuoteRows;
    const secondApprovalId = secondQuote?.approval_request_id as string;
    expect(secondApprovalId).toBeTruthy();
    expect(secondApprovalId).not.toBe(firstApprovalId);

    // The prior approval is withdrawn, not left pending.
    const { data: firstApprovalRow } = await admin
      .from("approval_requests")
      .select("state")
      .eq("id", firstApprovalId)
      .single();
    expect(firstApprovalRow?.state).toBe("withdrawn");

    // Approving the stale, withdrawn approval now fails outright instead
    // of silently doing nothing.
    const { error: staleDecideError } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: firstApprovalId,
      p_decision: "approved",
    });
    expect(staleDecideError).not.toBeNull();

    // Approving the live, current approval works and produces exactly
    // one scope item.
    const { error: liveDecideError } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: secondApprovalId,
      p_decision: "approved",
    });
    expect(liveDecideError).toBeNull();

    const { data: approvals } = await admin
      .from("approval_requests")
      .select("id, state")
      .eq("subject_id", requestId)
      .eq("subject_type", "artifact");
    expect((approvals ?? []).filter((a) => a.state === "approved")).toHaveLength(1);
    expect((approvals ?? []).filter((a) => a.state === "pending")).toHaveLength(0);

    const { data: scopeItems } = await admin
      .from("project_scope_items")
      .select("id")
      .eq("change_request_id", requestId);
    expect(scopeItems).toHaveLength(1);
  });
});
