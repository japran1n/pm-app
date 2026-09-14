// Integration test for F117 (chat-subsystem security hardening pass on
// top of missions/20260903-portal's F116 handoff, out-of-scope items 2 and
// 3): real signed-in sessions against PostgREST/Server Actions, same
// convention as tests/integration/f116-client-chat-channel-rls.test.ts and
// tests/integration/f006i-create-channel-atomic-authz.test.ts.
//
// Item 2 investigation (see F117 handoff for the full writeup): the F116
// handoff claimed `create_channel_atomic` was "still granted to
// `authenticated` directly ... bypassing createChannel's own app-layer
// checks entirely." Grepping the migration history shows this claim was
// stale by the time F116 landed -- 20260918010000_f006i_authz_round_2.sql
// (which predates F116) already added a full internal `auth.uid()`-gated
// check to this exact function: caller identity, non-client role, and
// per-member workspace membership. tests/integration/
// f006i-create-channel-atomic-authz.test.ts already proves this (6/6
// passing on the CURRENT schema, run again below as part of this task's
// required "watch it fail, then fix, then watch it pass" step -- it did
// NOT fail, because the hole is already closed). The block below adds one
// more explicit regression case matching this task's own wording (a plain
// signed-in user calling the RPC directly over supabase-js with a
// fabricated member list), plus the specific client-self-enrollment
// scenario F116 made newly reachable (a client is now an ordinary
// `channel_members` participant, so a client calling this RPC directly to
// add themselves to an arbitrary channel is the concrete risk F116 raised
// -- already blocked by the existing "caller is not an active non-client
// member" check, verified again here against a project that has portal
// chat enabled).
//
// Item 3: createChannel's project-scoped INSERT check used to accept any
// caller `isProjectVisibleToCaller` would admit (workspace-visible
// projects open to every active member, plus an unconditional owner/admin
// bypass) -- broader than the project_members-only rule F116 applied to
// SELECT/self-add for the exact same channels. Fixed in
// lib/actions/chat-channels.ts to require an explicit `project_members`
// row, matching browse. This block proves the negative (an active,
// non-project-member workspace member -- including an owner -- can no
// longer create a channel for a workspace-visible project they are not
// explicitly on) and the positive control (an explicit project member
// still can).

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
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";
const RLS_DENIED = "42501";

let currentTestClient: { auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> } } = {
  auth: { getUser: async () => ({ data: { user: null } }) },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveCreds)("F117 — chat security hardening", () => {
  let admin: SupabaseClient;

  let workspaceId: string;
  let ownerId: string; // workspace owner, NOT an explicit project_members row
  let projectMemberId: string; // active member, explicit project_members row
  let clientId: string; // client, member of the project's channel post-portal-enable
  let outsiderWorkspaceId: string;
  let outsiderId: string; // active member of a DIFFERENT workspace entirely

  let _ownerSession: SupabaseClient;
  let _projectMemberSession: SupabaseClient;
  let clientSession: SupabaseClient;
  let outsiderSession: SupabaseClient;

  let projectId: string;
  let projectChannelId: string;

  const createdUserIds: string[] = [];
  const createdChannelIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f117-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const projMember = await makeUser("projmember");
    const client = await makeUser("client");
    const outsider = await makeUser("outsider");
    ownerId = owner.id;
    projectMemberId = projMember.id;
    clientId = client.id;
    outsiderId = outsider.id;

    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F117 workspace", slug: `f117-ws-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const { data: wsB, error: wsBErr } = await admin
      .from("workspaces")
      .insert({ name: "F117 outsider workspace", slug: `f117-ws-b-${suffix}` })
      .select("id")
      .single();
    if (wsBErr || !wsB) throw new Error(`workspace B: ${wsBErr?.message}`);
    outsiderWorkspaceId = wsB.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: projectMemberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: outsiderWorkspaceId, user_id: outsiderId, role: "member", status: "active" },
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F117 project",
        // Deliberately workspace-visible: the pre-fix bug for item 3 was
        // reachable exactly because any active member of a
        // workspace-visible project could create its channel via
        // isProjectVisibleToCaller's workspace-visible branch.
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    // Only projectMemberId (not ownerId) has an explicit project_members
    // row -- proving the owner/admin bypass isProjectVisibleToCaller used
    // to grant is gone too.
    await admin.from("project_members").insert([
      { project_id: projectId, user_id: projectMemberId, project_role: "lead", added_by: ownerId },
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    _ownerSession = await signIn(owner.email);
    _projectMemberSession = await signIn(projMember.email);
    clientSession = await signIn(client.email);
    outsiderSession = await signIn(outsider.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (createdChannelIds.length) {
      await admin.from("channel_members").delete().in("channel_id", createdChannelIds);
      await admin.from("channels").delete().in("id", createdChannelIds);
    }
    if (projectChannelId) {
      await admin.from("channel_members").delete().eq("channel_id", projectChannelId);
      await admin.from("channels").delete().eq("id", projectChannelId);
    }
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().in("workspace_id", [workspaceId, outsiderWorkspaceId]);
    await admin.from("workspaces").delete().in("id", [workspaceId, outsiderWorkspaceId]);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  describe("item 2 — create_channel_atomic direct-RPC authorisation (regression, matches this task's own scenario wording)", () => {
    it("an ordinary signed-in user calling create_channel_atomic directly over PostgREST with a fabricated member list is rejected", async () => {
      const { data, error } = await outsiderSession.rpc("create_channel_atomic", {
        p_workspace_id: workspaceId,
        p_kind: "channel",
        p_created_by: outsiderId,
        // Fabricated member list naming real users of the TARGET workspace
        // the caller does not belong to.
        p_member_ids: [outsiderId, ownerId, projectMemberId],
        p_name: "F117 fabricated-membership channel",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe(RLS_DENIED);
      expect(data).toBeNull();

      const { data: rows } = await admin
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", "F117 fabricated-membership channel");
      expect(rows ?? []).toHaveLength(0);
    });

    it("a client (self-enrollable participant as of F116) cannot self-enroll into an arbitrary channel via a direct create_channel_atomic call", async () => {
      const { data, error } = await clientSession.rpc("create_channel_atomic", {
        p_workspace_id: workspaceId,
        p_kind: "channel",
        p_created_by: clientId,
        p_member_ids: [clientId],
        p_name: "F117 client self-enroll channel",
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe(RLS_DENIED);
      expect(data).toBeNull();

      const { data: rows } = await admin
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", "F117 client self-enroll channel");
      expect(rows ?? []).toHaveLength(0);
    });
  });

  describe("item 3 — createChannel's project-scoped INSERT check now matches the project_members-only browse rule", () => {
    it("an active workspace OWNER who is not an explicit project_members row cannot create the project's channel", async () => {
      const { createChannel } = await import("@/lib/actions/chat-channels");

      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
      };

      const result = await createChannel({
        workspaceId,
        kind: "channel",
        name: "F117 owner-not-project-member channel",
        projectId,
        memberIds: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Project not found.");
      }

      const { data: rows } = await admin
        .from("channels")
        .select("id")
        .eq("project_id", projectId);
      expect(rows ?? []).toHaveLength(0);
    });

    it("an explicit project_members row CAN still create the project's channel", async () => {
      const { createChannel } = await import("@/lib/actions/chat-channels");

      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: { id: projectMemberId } } }) },
      };

      const result = await createChannel({
        workspaceId,
        kind: "channel",
        name: "F117 project member channel",
        projectId,
        memberIds: [clientId],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        projectChannelId = result.data.id;

        const { data: memberRows } = await admin
          .from("channel_members")
          .select("user_id")
          .eq("channel_id", result.data.id);
        expect((memberRows ?? []).map((r) => r.user_id).sort()).toEqual(
          [projectMemberId, clientId].sort(),
        );
      }
    });
  });
});
