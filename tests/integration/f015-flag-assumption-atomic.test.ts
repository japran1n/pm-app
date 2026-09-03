// Integration test for F015 (missions/20260903-portal, M3 — scope,
// decisions, assumptions, both sides): `flag_assumption_atomic`. Covers
// AS-046 ("the client can flag one as incorrect from the portal").
//
// Driven through real signed-in sessions and PostgREST/RPC, matching this
// suite's established convention (tests/integration/f012-deliverables-
// scope-decisions-assumptions-rls.test.ts, f014-mark-deliverable-
// delivered.test.ts) — the point is exercising the RPC's own
// authorization against a real database.

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

describe.skipIf(!haveCreds)("flag_assumption_atomic (AS-046)", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;
  let outsiderSession: SupabaseClient;

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
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
        email: `f015-flag-${label}-${suffix}@example.com`,
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
    const outsiderUser = await makeUser("outsider");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F015 flag test", slug: `f015-flag-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
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
      { project_id: disabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

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
    outsiderSession = await signIn(outsiderUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("notifications").delete().eq("workspace_id", workspaceId);
    await admin.from("audit_log").delete().eq("workspace_id", workspaceId);
    await admin.from("project_assumptions").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_members").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  let assumptionId: string;

  beforeEach(async () => {
    const { data, error } = await admin
      .from("project_assumptions")
      .insert({
        project_id: enabledProjectId,
        text: "The client will provide final copy by kickoff.",
        state: "assumed",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`assumption: ${error?.message}`);
    assumptionId = data.id;
  });

  it("a client of the project can flag an assumption, writing flagged_by_client_at and flagged_note but never state", async () => {
    const { data, error } = await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "We're actually providing this a week late.",
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.flagged_by_client_at).toBeTruthy();

    const { data: updated } = await admin
      .from("project_assumptions")
      .select("state, flagged_by_client_at, flagged_note")
      .eq("id", assumptionId)
      .single();
    expect(updated?.state).toBe("assumed");
    expect(updated?.flagged_note).toBe("We're actually providing this a week late.");
    expect(updated?.flagged_by_client_at).toBeTruthy();
  });

  it("writes an audit_log row", async () => {
    await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "Audited note.",
    });

    const { data: entries } = await admin
      .from("audit_log")
      .select("action, target_id, target_type")
      .eq("workspace_id", workspaceId)
      .eq("target_id", assumptionId)
      .eq("action", "project_assumption.flagged_by_client");

    expect(entries?.length).toBeGreaterThanOrEqual(1);
  });

  it("creates a team notification for an active non-viewer, non-client workspace member", async () => {
    await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "Notify the team please.",
    });

    const { data: notifications } = await admin
      .from("notifications")
      .select("user_id, kind, payload")
      .eq("workspace_id", workspaceId)
      .eq("kind", "assumption_flagged");

    expect(notifications?.length).toBeGreaterThanOrEqual(1);
    const recipientIds = (notifications ?? []).map((n) => n.user_id);
    expect(recipientIds).toContain(memberId);
    expect(recipientIds).not.toContain(clientId);
  });

  it("rejects an empty note", async () => {
    const { error } = await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "   ",
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin
      .from("project_assumptions")
      .select("flagged_by_client_at")
      .eq("id", assumptionId)
      .single();
    expect(unchanged?.flagged_by_client_at).toBeNull();
  });

  it("rejects a team member calling it — only a client of the project may flag", async () => {
    const { error } = await memberSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "A team member trying to flag their own assumption.",
    });
    expect(error).not.toBeNull();

    const { data: unchanged } = await admin
      .from("project_assumptions")
      .select("flagged_by_client_at")
      .eq("id", assumptionId)
      .single();
    expect(unchanged?.flagged_by_client_at).toBeNull();
  });

  it("rejects a caller with no membership on the assumption's project", async () => {
    const { error } = await outsiderSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "An outsider trying to flag.",
    });
    expect(error).not.toBeNull();
  });

  it("rejects a client on a portal-disabled project", async () => {
    const { data, error: insertErr } = await admin
      .from("project_assumptions")
      .insert({
        project_id: disabledProjectId,
        text: "Portal-off assumption.",
        state: "assumed",
      })
      .select("id")
      .single();
    if (insertErr || !data) throw new Error(`assumption: ${insertErr?.message}`);

    const { error } = await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: data.id,
      p_note: "Trying to flag on a disabled portal.",
    });
    expect(error).not.toBeNull();

    await admin.from("project_assumptions").delete().eq("id", data.id);
  });

  it("does not change state even when re-flagged twice", async () => {
    await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "First note.",
    });
    await clientSession.rpc("flag_assumption_atomic", {
      p_assumption_id: assumptionId,
      p_note: "Second, corrected note.",
    });

    const { data: row } = await admin
      .from("project_assumptions")
      .select("state, flagged_note")
      .eq("id", assumptionId)
      .single();
    expect(row?.state).toBe("assumed");
    expect(row?.flagged_note).toBe("Second, corrected note.");
  });
});
