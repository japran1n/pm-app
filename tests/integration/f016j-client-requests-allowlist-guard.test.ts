// Integration test for F016j (missions/20260903-portal, M3 remediation):
// client_requests.origin_assumption_id (F016b) was writable by a client
// at INSERT, absent from F016d/F016f's guard column list, and
// dereferenced with no project predicate — the exact hijack shape F016f
// closed for approval_request_id one migration earlier (the seventh
// instance of this class in the mission).
//
// Fixed by 20261008010000: the guard trigger was inverted from a
// hand-enumerated deny-list to an allow-list (title, body, desired_by,
// plus identity columns at INSERT), and the assumption-invalidation
// write is now project-scoped as defense in depth.
//
// Driven through real signed-in sessions and RPC calls, matching this
// suite's established convention (f016's own integration test).

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
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
const haveManagementApi = Boolean(ACCESS_TOKEN && PROJECT_REF);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

// Runs a raw SQL string against the linked project via the Management
// API's query endpoint (the same mechanism scripts/apply-migration.mjs
// uses) — needed only for the self-maintaining-guard test, which must
// add and drop a real column inside one rolled-back transaction, a
// thing no PostgREST call can do.
async function rawSql(sql: string): Promise<unknown> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  return JSON.parse(body);
}

describe.skipIf(!haveCreds)("client_requests allow-list guard (F016j)", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;

  // A second, entirely separate project — the "another project" a
  // fabricated origin_assumption_id might try to reach into.
  let otherProjectId: string;
  let otherAssumptionId: string;
  let inProjectAssumptionId: string;

  const createdUserIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f016j-cr-${label}-${suffix}@example.com`,
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
      .insert({ name: "F016j allow-list guard test", slug: `f016j-cr-${suffix}` })
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
        name: "Allow-list guard project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    projectId = project.id;

    const { data: otherProject, error: otherProjErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "A different project entirely",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (otherProjErr || !otherProject) throw new Error(`other project: ${otherProjErr?.message}`);
    otherProjectId = otherProject.id;

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    await admin.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "commercial",
      user_id: clientId,
    });

    const { data: otherAssumption, error: otherAssumErr } = await admin
      .from("project_assumptions")
      .insert({ project_id: otherProjectId, text: "An assumption on a project the client cannot see" })
      .select("id")
      .single();
    if (otherAssumErr || !otherAssumption) throw new Error(`other assumption: ${otherAssumErr?.message}`);
    otherAssumptionId = otherAssumption.id;

    const { data: inProjectAssumption, error: inProjectAssumErr } = await admin
      .from("project_assumptions")
      .insert({ project_id: projectId, text: "An assumption in the client's own project" })
      .select("id")
      .single();
    if (inProjectAssumErr || !inProjectAssumption)
      throw new Error(`in-project assumption: ${inProjectAssumErr?.message}`);
    inProjectAssumptionId = inProjectAssumption.id;

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
    await admin.from("client_requests").delete().in("id", createdRequestIds);
    await admin.from("project_assumptions").delete().in("id", [otherAssumptionId, inProjectAssumptionId]);
    await admin.from("project_decision_owners").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("projects").delete().eq("id", otherProjectId);
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

  // --- Primary success test: origin_assumption_id is unwritable ------------

  it("test_AS_047_a_client_cannot_insert_a_request_naming_an_assumption_in_another_project", async () => {
    const { error } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Hijack a foreign assumption",
      status: "submitted",
      origin_assumption_id: otherAssumptionId,
    });
    expect(error).not.toBeNull();
  });

  it("test_AS_047_a_client_cannot_insert_a_request_naming_an_in_project_assumption_they_were_not_offered", async () => {
    const { error } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Self-attach to an assumption nobody offered me",
      status: "submitted",
      origin_assumption_id: inProjectAssumptionId,
    });
    expect(error).not.toBeNull();

    // Confirm this isn't reachable end-to-end either: even if it HAD
    // been inserted, the eventual quote approval must not invalidate an
    // assumption the guard was supposed to keep the client from ever
    // linking.
    const { data: unchanged } = await admin
      .from("project_assumptions")
      .select("state")
      .eq("id", inProjectAssumptionId)
      .single();
    expect(unchanged?.state).toBe("assumed");
  });

  it("test_AS_047_a_client_cannot_set_origin_assumption_id_by_update_either", async () => {
    const requestId = await makeRequest("Ordinary request, then tries to attach an assumption");

    const { error } = await clientSession
      .from("client_requests")
      .update({ origin_assumption_id: inProjectAssumptionId })
      .eq("id", requestId);
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin
      .from("client_requests")
      .select("origin_assumption_id")
      .eq("id", requestId)
      .single();
    expect(unchanged?.origin_assumption_id).toBeNull();
  });

  // --- Failure test: the client can still author an ordinary request -------

  it("test_AS_047_a_client_can_still_create_and_edit_an_ordinary_request_with_the_fields_they_legitimately_author", async () => {
    const { data, error } = await clientSession
      .from("client_requests")
      .insert({
        project_id: projectId,
        created_by: clientId,
        title: "An ordinary request",
        body: "Nothing pre-filled.",
        desired_by: "2099-01-01",
      })
      .select("id, status, origin_assumption_id")
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe("submitted");
    expect(data?.origin_assumption_id).toBeNull();
    if (data?.id) createdRequestIds.push(data.id);

    const { error: updateError } = await clientSession
      .from("client_requests")
      .update({ title: "An ordinary request (edited)", body: "Still nothing pre-filled." })
      .eq("id", data!.id);
    expect(updateError).toBeNull();
  });

  // --- Round-2 gap: severity and kind were also missing from the old
  // deny-list; the allow-list closes both automatically. ------------------

  it("test_AS_047_a_client_cannot_insert_a_request_already_carrying_kind_or_severity", async () => {
    const { error: kindError } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Pre-classified by me",
      status: "submitted",
      kind: "bug",
    });
    expect(kindError).not.toBeNull();

    const { error: severityError } = await clientSession.from("client_requests").insert({
      project_id: projectId,
      created_by: clientId,
      title: "Pre-severitised by me",
      status: "submitted",
      severity: "blocker",
    });
    expect(severityError).not.toBeNull();
  });

  it("test_AS_047_a_client_cannot_set_kind_or_severity_by_update_either", async () => {
    const requestId = await makeRequest("Ordinary request, then tries to reclassify it");

    const { error } = await clientSession
      .from("client_requests")
      .update({ kind: "bug", severity: "blocker" })
      .eq("id", requestId);
    expect(error).not.toBeNull();
  });

  // --- The eight previously-untested guarded columns (M3-scrutiny-3's
  // own note: dropping any of these from the guard kept the old suite
  // green). One INSERT test and one UPDATE test cover all eight, since
  // the guard now rejects the FIRST differing key it finds in one pass
  // — a per-column split would only duplicate the same assertion. -------

  it("test_AS_047_a_client_cannot_insert_a_request_carrying_any_of_the_eight_previously_untested_guarded_columns", async () => {
    const attempts: Record<string, unknown>[] = [
      { quoted_hours: 4 },
      { quote_currency: "USD" },
      { quote_note: "self-authored note" },
      { quote_valid_until: "2099-01-01" },
      { decided_at: new Date().toISOString() },
      { track: "dev_change" },
      { track_overridden: true },
      { track_override_reason: "because I said so" },
    ];
    for (const extra of attempts) {
      const { error } = await clientSession.from("client_requests").insert({
        project_id: projectId,
        created_by: clientId,
        title: `Pre-carrying ${Object.keys(extra)[0]}`,
        status: "submitted",
        ...extra,
      });
      expect(error, `expected insert with ${Object.keys(extra)[0]} to be rejected`).not.toBeNull();
    }
  });

  it("test_AS_047_a_client_cannot_update_any_of_the_eight_previously_untested_guarded_columns", async () => {
    const attempts: Record<string, unknown>[] = [
      { quoted_hours: 4 },
      { quote_currency: "USD" },
      { quote_note: "self-authored note" },
      { quote_valid_until: "2099-01-01" },
      { decided_at: new Date().toISOString() },
      { track: "dev_change" },
      { track_overridden: true },
      { track_override_reason: "because I said so" },
    ];
    for (const extra of attempts) {
      const requestId = await makeRequest(`Ordinary request, then tries to set ${Object.keys(extra)[0]}`);
      const { error } = await clientSession.from("client_requests").update(extra).eq("id", requestId);
      expect(error, `expected update with ${Object.keys(extra)[0]} to be rejected`).not.toBeNull();
    }
  });

  // --- The team's own legitimate paths still work unchanged ---------------

  it("the team can still triage, quote and raise a request from a flagged assumption, and the client can still approve it, invalidating only the in-project assumption named in the flow", async () => {
    // Flag the in-project assumption as the client would via the portal.
    const { error: flagError } = await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: inProjectAssumptionId,
      p_note: "This is not right.",
    });
    expect(flagError).toBeNull();

    const { data: raiseRows, error: raiseError } = await memberSession.rpc(
      "raise_change_request_from_assumption_atomic",
      { p_assumption_id: inProjectAssumptionId },
    );
    expect(raiseError).toBeNull();
    const raiseRow = Array.isArray(raiseRows) ? raiseRows[0] : raiseRows;
    const requestId = raiseRow?.request_id as string;
    expect(requestId).toBeTruthy();
    createdRequestIds.push(requestId);

    const { data: raisedRow } = await admin
      .from("client_requests")
      .select("origin_assumption_id, kind, scope_verdict")
      .eq("id", requestId)
      .single();
    expect(raisedRow?.origin_assumption_id).toBe(inProjectAssumptionId);

    const { data: quoteRows, error: quoteError } = await memberSession.rpc(
      "send_change_request_quote_atomic",
      {
        p_request_id: requestId,
        p_scope_verdict: "change_request",
        p_quoted_amount: 800,
        p_quote_valid_until: "2099-01-01",
      },
    );
    expect(quoteError).toBeNull();
    const quoteRow = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    const approvalRequestId = quoteRow?.approval_request_id as string;
    expect(approvalRequestId).toBeTruthy();

    const { error: decideError } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: approvalRequestId,
      p_decision: "approved",
    });
    expect(decideError).toBeNull();

    const { data: invalidated } = await admin
      .from("project_assumptions")
      .select("state")
      .eq("id", inProjectAssumptionId)
      .single();
    expect(invalidated?.state).toBe("invalidated");

    // The OTHER project's assumption was never touched by any of this.
    const { data: untouched } = await admin
      .from("project_assumptions")
      .select("state")
      .eq("id", otherAssumptionId)
      .single();
    expect(untouched?.state).toBe("assumed");
  });

  // --- Manual verification / self-maintaining test: a column added
  // AFTER this guard was written is covered without editing the guard.
  // Runs raw SQL through the Management API (the same mechanism
  // scripts/apply-migration.mjs uses) inside one transaction that is
  // always rolled back, so no schema change survives the test. -----------

  describe.skipIf(!haveManagementApi)("self-maintaining allow-list", () => {
    it("a column added after this migration is protected by default, with no edit to the guard function", async () => {
      // One DO block: ADD COLUMN, switch to a real `authenticated` /
      // client session (the same SET ROLE + request.jwt.claims
      // mechanism PostgREST itself uses), attempt an author INSERT that
      // sets the brand-new column, and unconditionally raise afterwards
      // so nothing this block did survives past its own implicit
      // transaction -- not the column, not the row it tried to insert.
      const sql = `
        do $probe$
        begin
          alter table public.client_requests
            add column if not exists f016j_probe_never_committed text;

          set local request.jwt.claims to '{"sub":"${clientId}","role":"authenticated"}';
          set local role authenticated;

          begin
            insert into public.client_requests (
              project_id, created_by, title, status, f016j_probe_never_committed
            ) values (
              '${projectId}', '${clientId}', 'Probe row (must be rejected)', 'submitted', 'author-supplied value'
            );
            raise exception 'GUARD_DID_NOT_FIRE';
          exception
            when sqlstate '42501' then
              null; -- expected: the allow-list guard rejected the new column
          end;

          reset role;
          raise exception 'ROLLBACK_PROBE_TRANSACTION';
        end;
        $probe$;
      `;

      let threw: unknown = null;
      try {
        await rawSql(sql);
      } catch (err) {
        threw = err;
      }

      expect(threw).not.toBeNull();
      const message = String(threw);
      expect(message).not.toMatch(/GUARD_DID_NOT_FIRE/);
      expect(message).toMatch(/ROLLBACK_PROBE_TRANSACTION/);

      // The probe column never survives outside its own rolled-back
      // transaction.
      const columns = (await rawSql(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'client_requests'
            and column_name = 'f016j_probe_never_committed';`,
      )) as unknown[];
      expect(columns).toEqual([]);
    }, 30_000);
  });
});
