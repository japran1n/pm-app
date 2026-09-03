// Integration test for F016b (missions/20260903-portal, M3 — "raise a
// change request from a flagged assumption"):
// `raise_change_request_from_assumption_atomic`, and the extension of
// `client_requests_sync_decision_from_approval` that moves the
// originating assumption to 'invalidated' on approval.
//
// Same "real signed-in sessions and RPC against a live database"
// convention as tests/integration/f015-flag-assumption-atomic.test.ts
// and tests/integration/f016-change-request-quote-gate.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe.skipIf(!haveCreds)("raise_change_request_from_assumption_atomic (F016b)", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let viewerSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f016b-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const viewerUser = await makeUser("viewer");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F016b test", slug: `f016b-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: viewerUser.id, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F016b project",
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
      { project_id: projectId, user_id: viewerUser.id, project_role: "member", added_by: ownerId },
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    // decide_approval_atomic's own ownership check (F009b): the client's
    // decision on a commercial quote needs a named decision owner — same
    // setup tests/integration/f016-change-request-quote-gate.test.ts uses.
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
    viewerSession = await signIn(viewerUser.email);
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("approval_requests").delete().eq("project_id", projectId);
    await admin.from("project_decision_owners").delete().eq("project_id", projectId);
    await admin.from("client_requests").delete().eq("project_id", projectId);
    await admin.from("project_assumptions").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  let flaggedAssumptionId: string;
  let unflaggedAssumptionId: string;

  beforeEach(async () => {
    const { data: flagged, error: flaggedErr } = await admin
      .from("project_assumptions")
      .insert({
        project_id: projectId,
        text: "The client will provide brand assets before launch.",
        state: "assumed",
        flagged_by_client_at: new Date().toISOString(),
        flagged_note: "We don't have brand assets ready — this needs new design work.",
      })
      .select("id")
      .single();
    if (flaggedErr || !flagged) throw new Error(`flagged assumption: ${flaggedErr?.message}`);
    flaggedAssumptionId = flagged.id;

    const { data: unflagged, error: unflaggedErr } = await admin
      .from("project_assumptions")
      .insert({
        project_id: projectId,
        text: "An assumption nobody has flagged.",
        state: "assumed",
      })
      .select("id")
      .single();
    if (unflaggedErr || !unflagged) throw new Error(`unflagged assumption: ${unflaggedErr?.message}`);
    unflaggedAssumptionId = unflagged.id;
  });

  it("primary success: a team member raises a change request from a flagged assumption, carrying its text and the client's note, linked back to the assumption", async () => {
    const { data, error } = await memberSession.rpc(
      "raise_change_request_from_assumption_atomic",
      { p_assumption_id: flaggedAssumptionId },
    );
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.request_id).toBeTruthy();

    const { data: request } = await admin
      .from("client_requests")
      .select("kind, scope_verdict, title, body, origin_assumption_id, project_id")
      .eq("id", row.request_id)
      .single();

    expect(request?.kind).toBe("change");
    expect(request?.scope_verdict).toBe("change_request");
    expect(request?.title).toContain("The client will provide brand assets before launch.");
    expect(request?.body).toBe(
      "We don't have brand assets ready — this needs new design work.",
    );
    expect(request?.origin_assumption_id).toBe(flaggedAssumptionId);
    expect(request?.project_id).toBe(projectId);
  });

  it("is unavailable on an unflagged assumption", async () => {
    const { error } = await memberSession.rpc(
      "raise_change_request_from_assumption_atomic",
      { p_assumption_id: unflaggedAssumptionId },
    );
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("origin_assumption_id", unflaggedAssumptionId);
    expect(count).toBe(0);
  });

  it("is rejected for a role that cannot create client requests (viewer)", async () => {
    const { error } = await viewerSession.rpc(
      "raise_change_request_from_assumption_atomic",
      { p_assumption_id: flaggedAssumptionId },
    );
    expect(error).not.toBeNull();
  });

  it("is rejected for a client caller — matches the same bar as every other team-triage RPC", async () => {
    const { error } = await clientSession.rpc(
      "raise_change_request_from_assumption_atomic",
      { p_assumption_id: flaggedAssumptionId },
    );
    expect(error).not.toBeNull();
  });

  it("manual verification: approving the resulting change request's quote moves the originating assumption to invalidated", async () => {
    const { data: raised } = await memberSession.rpc(
      "raise_change_request_from_assumption_atomic",
      { p_assumption_id: flaggedAssumptionId },
    );
    const requestId = (Array.isArray(raised) ? raised[0] : raised)?.request_id as string;
    expect(requestId).toBeTruthy();

    const { data: quoted, error: quoteError } = await memberSession.rpc(
      "send_change_request_quote_atomic",
      {
        p_request_id: requestId,
        p_scope_verdict: "change_request",
        p_quoted_hours: 4,
        p_quoted_amount: 400,
        p_quote_currency: "USD",
        p_quote_valid_until: "2099-01-01",
      },
    );
    expect(quoteError).toBeNull();
    const approvalRequestId = (Array.isArray(quoted) ? quoted[0] : quoted)?.approval_request_id as string;
    expect(approvalRequestId).toBeTruthy();

    const { error: decideError } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: approvalRequestId,
      p_decision: "approved",
    });
    expect(decideError).toBeNull();

    const { data: assumption } = await admin
      .from("project_assumptions")
      .select("state")
      .eq("id", flaggedAssumptionId)
      .single();
    expect(assumption?.state).toBe("invalidated");
  });
});
