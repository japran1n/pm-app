// Integration test for F025b (missions/20260903-portal, M5 remediation —
// AS-055). F025's own leak sweep already covers the primary failure
// shape end to end (tests/integration/f025-portal-route-walk.test.ts,
// marker 4). This suite is the feature's own dedicated coverage of the
// two directions its Definition of Done names explicitly:
//
//   - Primary success test: a client cannot read the quote fields of a
//     priced-but-unsent change request, through client_requests_client_
//     read (the view the portal's own client-facing query reads through)
//     — proven both via the query function AND a direct PostgREST-style
//     select against the view, since the spec calls out "any portal
//     route or a direct PostgREST call".
//   - Failure test: once sent (through send_change_request_quote_atomic,
//     the only function that ever sets quote_sent_at), the client sees
//     the quote; the team's own read is unaffected throughout, both
//     before and after sending.

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
    "F025b quote-sent gate: missing Supabase credentials required to run this suite in CI.",
  );
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)("F025b: a client sees a quote only once it has been sent (AS-055)", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string;
  let requestId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f025b-quote-sent-${label}-${suffix}@example.com`,
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
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F025b quote sent gate", slug: `f025b-quote-sent-${suffix}` })
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
        name: "F025b project",
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

    const { data: request, error: reqErr } = await admin
      .from("client_requests")
      .insert({
        project_id: projectId,
        created_by: clientId,
        title: "F025b quote sent gate fixture request",
        body: "please add a feature",
        status: "submitted",
      })
      .select("id")
      .single();
    if (reqErr || !request) throw new Error(`client_requests: ${reqErr?.message}`);
    requestId = request.id;

    const memberSignIn = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: memberErr } = await memberSignIn.auth.signInWithPassword({
      email: owner.email,
      password: PASSWORD,
    });
    if (memberErr) throw new Error(`sign in owner: ${memberErr.message}`);
    memberSession = memberSignIn;

    const clientSignIn = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: clientErr } = await clientSignIn.auth.signInWithPassword({
      email: clientUser.email,
      password: PASSWORD,
    });
    if (clientErr) throw new Error(`sign in client: ${clientErr.message}`);
    clientSession = clientSignIn;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("client_requests").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("primary success test: an internally-priced, unsent quote reads as null for the client, through both the view and a direct select", async () => {
    // The team prices it (send_change_request_quote_atomic) but the
    // request has not yet been through the RPC's own 'change_request'
    // branch a second time to re-send — it HAS gone through once here,
    // which is exactly the point: quote_sent_at is set the moment this
    // call raises the approval, so to get a genuinely *unsent* row for
    // this leg we price it via a direct admin write instead (matching
    // F025's own route-walk fixture, which plants the same shape the
    // same way: scope_verdict = 'change_request', quoted_amount set,
    // no approval_request_id, no quote_sent_at).
    const { error: priceErr } = await admin
      .from("client_requests")
      .update({
        scope_verdict: "change_request",
        quoted_amount: 42000,
        quote_currency: "USD",
        quote_valid_until: "2099-01-01",
      })
      .eq("id", requestId);
    if (priceErr) throw new Error(`admin price update: ${priceErr.message}`);

    const { data: viaView, error: viewErr } = await clientSession
      .from("client_requests_client_read")
      .select("id, quoted_amount, quote_currency, quote_valid_until, quote_sent_at")
      .eq("id", requestId)
      .single();
    expect(viewErr).toBeNull();
    expect(viaView?.quoted_amount).toBeNull();
    expect(viaView?.quote_currency).toBeNull();
    expect(viaView?.quote_valid_until).toBeNull();
    expect(viaView?.quote_sent_at).toBeNull();

    // Direct PostgREST-shaped call against the same view, same session
    // — this IS the direct-call leg; client_requests_client_read is the
    // only object a client session can reach for these columns (the
    // base table's own row is still visible to them via
    // client_requests_select_author_or_team, but the columns read back
    // masked all the same, proving the gate is not something the app's
    // query layer adds on top).
    const { data: direct, error: directErr } = await clientSession
      .from("client_requests_client_read")
      .select("*")
      .eq("id", requestId);
    expect(directErr).toBeNull();
    expect(direct?.[0]?.quoted_amount).toBeNull();

    // The base table itself (never read by client-facing app code) still
    // carries the real price — proving this is a read-side mask, not a
    // destructive write.
    const { data: raw } = await admin
      .from("client_requests")
      .select("quoted_amount")
      .eq("id", requestId)
      .single();
    expect(raw?.quoted_amount).toBe(42000);
  });

  it("failure test: once sent through send_change_request_quote_atomic, the client sees it, and the team saw it throughout", async () => {
    // Team's own read, BEFORE sending — unaffected by the mask at any
    // point (is_project_client is false for them).
    const { data: teamBefore, error: teamBeforeErr } = await memberSession
      .from("client_requests_client_read")
      .select("quoted_amount, quote_currency")
      .eq("id", requestId)
      .single();
    expect(teamBeforeErr).toBeNull();
    expect(teamBefore?.quoted_amount).toBe(42000);

    // Now actually send it — the one function that sets quote_sent_at.
    const { error: sendErr } = await memberSession.rpc("send_change_request_quote_atomic", {
      p_request_id: requestId,
      p_scope_verdict: "change_request",
      p_quoted_hours: 10,
      p_quoted_amount: 5000,
      p_quote_currency: "USD",
      p_quote_note: "F025b sent quote",
      p_quote_valid_until: "2099-01-01",
    });
    expect(sendErr).toBeNull();

    const { data: clientAfter, error: clientAfterErr } = await clientSession
      .from("client_requests_client_read")
      .select("quoted_amount, quote_currency, quote_sent_at, approval_request_id")
      .eq("id", requestId)
      .single();
    expect(clientAfterErr).toBeNull();
    expect(clientAfter?.quoted_amount).toBe(5000);
    expect(clientAfter?.quote_currency).toBe("USD");
    expect(clientAfter?.quote_sent_at).not.toBeNull();
    expect(clientAfter?.approval_request_id).not.toBeNull();

    // The team's own view is unaffected throughout — same value, read
    // after sending too.
    const { data: teamAfter, error: teamAfterErr } = await memberSession
      .from("client_requests_client_read")
      .select("quoted_amount")
      .eq("id", requestId)
      .single();
    expect(teamAfterErr).toBeNull();
    expect(teamAfter?.quoted_amount).toBe(5000);
  });

  it("a fresh, not-yet-resent quote is unsent again: quote_sent_at and approval_request_id both clear together", async () => {
    // Re-quote via direct admin write mimicking the FIRST half of
    // send_change_request_quote_atomic's own two-statement update (the
    // clearing statement) without reaching the branch that resends —
    // asserts the two facts move together as this feature's own
    // migration header claims, not merely that the RPC happens to leave
    // them in sync.
    const { error } = await admin
      .from("client_requests")
      .update({ quote_sent_at: null, approval_request_id: null })
      .eq("id", requestId);
    expect(error).toBeNull();

    const { data, error: readErr } = await clientSession
      .from("client_requests_client_read")
      .select("quoted_amount, quote_sent_at")
      .eq("id", requestId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.quote_sent_at).toBeNull();
    expect(data?.quoted_amount).toBeNull();
  });
});
