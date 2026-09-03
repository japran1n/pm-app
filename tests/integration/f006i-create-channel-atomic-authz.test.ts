// Integration test for F006i defect 4 (missions/20260903-portal,
// M1-scrutiny-2.md section 4 item 1 / FU-21): `create_channel_atomic` had
// no authorisation at all — SECURITY DEFINER, granted directly to
// `authenticated`, two unguarded INSERTs on caller-supplied workspace_id,
// created_by and member_ids. Every case below calls the RPC directly over
// `.rpc()`, as the attacker would — not through `lib/actions/
// chat-channels.ts`'s createChannel Server Action — except the final
// side-effect-verification case, which proves the legitimate app path
// (the Server Action, on the admin/service-role client) still works.

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

describe.skipIf(!haveCreds)("create_channel_atomic — authorisation (F006i defect 4)", () => {
  let admin: SupabaseClient;

  // Workspace A: where the target channel is created.
  let workspaceAId: string;
  let memberAId: string; // active non-client member of workspace A — the legitimate caller
  let clientAId: string; // active 'client' member of workspace A
  let memberASession: SupabaseClient;
  let clientASession: SupabaseClient;

  // Workspace B: an entirely separate workspace, and its own member.
  let workspaceBId: string;
  let outsiderId: string; // active member of workspace B, NOT of workspace A
  let outsiderSession: SupabaseClient;

  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdChannelIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f006i-cca-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const memberA = await makeUser("membera");
    const clientA = await makeUser("clienta");
    const outsider = await makeUser("outsider");
    memberAId = memberA.id;
    clientAId = clientA.id;
    outsiderId = outsider.id;

    const { data: wsA, error: wsAErr } = await admin
      .from("workspaces")
      .insert({ name: "F006i cca workspace A", slug: `f006i-cca-a-${suffix}` })
      .select("id")
      .single();
    if (wsAErr || !wsA) throw new Error(`workspace A: ${wsAErr?.message}`);
    workspaceAId = wsA.id;
    createdWorkspaceIds.push(workspaceAId);

    const { data: wsB, error: wsBErr } = await admin
      .from("workspaces")
      .insert({ name: "F006i cca workspace B", slug: `f006i-cca-b-${suffix}` })
      .select("id")
      .single();
    if (wsBErr || !wsB) throw new Error(`workspace B: ${wsBErr?.message}`);
    workspaceBId = wsB.id;
    createdWorkspaceIds.push(workspaceBId);

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceAId, user_id: memberAId, role: "member", status: "active" },
      { workspace_id: workspaceAId, user_id: clientAId, role: "client", status: "active" },
      { workspace_id: workspaceBId, user_id: outsiderId, role: "member", status: "active" },
    ]);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };

    memberASession = await signIn(memberA.email);
    clientASession = await signIn(clientA.email);
    outsiderSession = await signIn(outsider.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (createdChannelIds.length) {
      await admin.from("channel_members").delete().in("channel_id", createdChannelIds);
      await admin.from("channels").delete().in("id", createdChannelIds);
    }
    for (const wsId of createdWorkspaceIds) {
      await admin.from("workspace_members").delete().eq("workspace_id", wsId);
      await admin.from("workspaces").delete().eq("id", wsId);
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // ----------------------------------------------------------------------
  // Definition of done's own failure test.
  // ----------------------------------------------------------------------

  it("failure test: an authenticated user who is not a member of the workspace cannot create a channel in it", async () => {
    const { data, error } = await outsiderSession.rpc("create_channel_atomic", {
      p_workspace_id: workspaceAId,
      p_kind: "channel",
      p_created_by: outsiderId,
      p_member_ids: [outsiderId],
      p_name: "Outsider channel",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
    expect(data).toBeNull();

    const { data: rows } = await admin
      .from("channels")
      .select("id")
      .eq("workspace_id", workspaceAId)
      .eq("name", "Outsider channel");
    expect(rows ?? []).toHaveLength(0);
  });

  it("a client-role member of the workspace cannot create a channel (caller must be an active NON-CLIENT member)", async () => {
    const { data, error } = await clientASession.rpc("create_channel_atomic", {
      p_workspace_id: workspaceAId,
      p_kind: "channel",
      p_created_by: clientAId,
      p_member_ids: [clientAId],
      p_name: "Client-created channel",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
    expect(data).toBeNull();

    const { data: rows } = await admin
      .from("channels")
      .select("id")
      .eq("workspace_id", workspaceAId)
      .eq("name", "Client-created channel");
    expect(rows ?? []).toHaveLength(0);
  });

  it("a caller cannot attribute a channel to someone else (p_created_by must equal auth.uid())", async () => {
    const { data, error } = await memberASession.rpc("create_channel_atomic", {
      p_workspace_id: workspaceAId,
      p_kind: "channel",
      // Spoofing another real member of the SAME workspace as the creator.
      p_created_by: clientAId,
      p_member_ids: [memberAId],
      p_name: "Spoofed-creator channel",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
    expect(data).toBeNull();

    const { data: rows } = await admin
      .from("channels")
      .select("id")
      .eq("workspace_id", workspaceAId)
      .eq("name", "Spoofed-creator channel");
    expect(rows ?? []).toHaveLength(0);
  });

  it("a caller cannot enroll a member_id that does not belong to the target workspace", async () => {
    const { data, error } = await memberASession.rpc("create_channel_atomic", {
      p_workspace_id: workspaceAId,
      p_kind: "channel",
      p_created_by: memberAId,
      // outsiderId is a real user, but a member of workspace B, not A.
      p_member_ids: [memberAId, outsiderId],
      p_name: "Cross-workspace member channel",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
    expect(data).toBeNull();

    const { data: rows } = await admin
      .from("channels")
      .select("id")
      .eq("workspace_id", workspaceAId)
      .eq("name", "Cross-workspace member channel");
    expect(rows ?? []).toHaveLength(0);
  });

  it("positive control: an active non-client member of the workspace can create a channel with valid members, called directly over RPC", async () => {
    const { data: channelId, error } = await memberASession.rpc("create_channel_atomic", {
      p_workspace_id: workspaceAId,
      p_kind: "channel",
      p_created_by: memberAId,
      p_member_ids: [memberAId, clientAId],
      p_name: "Legitimate channel",
    });

    expect(error).toBeNull();
    expect(channelId).toBeTruthy();
    if (channelId) createdChannelIds.push(channelId as unknown as string);

    const { data: channelRow } = await admin
      .from("channels")
      .select("id, workspace_id, created_by, name")
      .eq("id", channelId as unknown as string)
      .single();
    expect(channelRow?.workspace_id).toBe(workspaceAId);
    expect(channelRow?.created_by).toBe(memberAId);

    const { data: memberRows } = await admin
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId as unknown as string);
    expect((memberRows ?? []).map((r) => r.user_id).sort()).toEqual(
      [memberAId, clientAId].sort(),
    );
  });

  // ----------------------------------------------------------------------
  // Side-effect verification (Definition of done): the legitimate app
  // path — lib/actions/chat-channels.ts's createChannel Server Action,
  // which calls this RPC on the ADMIN (service-role) client after
  // independently re-verifying membership/visibility itself — still
  // works. A service-role JWT carries no `sub` claim, so auth.uid() is
  // null for that call and the new checks above are skipped entirely for
  // it, exactly as create_notification's identical `auth.uid() is null`
  // branch already establishes.
  // ----------------------------------------------------------------------

  it("side-effect verification: the createChannel Server Action (admin/service-role RPC call) still creates a channel for a legitimate caller", async () => {
    const { createChannel } = await import("@/lib/actions/chat-channels");

    currentTestClient = {
      auth: { getUser: async () => ({ data: { user: { id: memberAId } } }) },
    };

    const result = await createChannel({
      workspaceId: workspaceAId,
      kind: "channel",
      name: "Server Action channel",
      memberIds: [clientAId],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      createdChannelIds.push(result.data.id);

      const { data: channelRow } = await admin
        .from("channels")
        .select("id, workspace_id, created_by")
        .eq("id", result.data.id)
        .single();
      expect(channelRow?.workspace_id).toBe(workspaceAId);
      expect(channelRow?.created_by).toBe(memberAId);

      const { data: memberRows } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", result.data.id);
      expect((memberRows ?? []).map((r) => r.user_id).sort()).toEqual(
        [memberAId, clientAId].sort(),
      );
    }
  });
});
