// Integration test for F116 (docs/client-portal-phase-2-plan.md item A):
// connecting the existing chat system to the client portal. Same
// convention as tests/integration/f113-page-links-rls.test.ts: real
// signed-in sessions against PostgREST, not a mocked query builder.
//
// Written FIRST against the pre-fix schema (20260904020000_chat_system.sql
// alone) and watched to fail before 20261103010000_f116_client_channel_
// access.sql landed -- see this feature's handoff for the failure output.
//
// Covers:
//   - a client cannot SELECT another project's channel by id (cross-project
//     leak, the failure case called out explicitly in the task);
//   - a client cannot self-add (channel_members insert) into another
//     project's channel by guessing its id;
//   - a client cannot browse/self-join the workspace's own internal
//     workspace-wide channel;
//   - a `viewer` who is NOT an explicit member of the project cannot browse
//     into a client's project channel just because the project itself is
//     workspace-visible (the "a client's words leak to a viewer" case);
//   - a client who IS an explicit member of their own project channel CAN
//     read and post there, and sees the same messages/roster a project
//     team member sees;
//   - a client cannot read messages in a channel they were never added to,
//     even via full-text search;
//   - `ensure_project_channel_atomic` is idempotent (two calls, one
//     channel, no duplicate membership rows) and is not directly callable
//     by an ordinary authenticated session (service_role only).

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

describe.skipIf(!haveCreds)("client chat channel access (F116)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;
  let _otherClientSession: SupabaseClient;
  let viewerSession: SupabaseClient;
  let memberSession: SupabaseClient;

  let workspaceId: string;
  let projectAId: string; // clientSession's own project
  let projectBId: string; // _otherClientSession's own project
  let ownerId: string;
  let memberId: string;
  let viewerId: string;
  let clientId: string;
  let otherClientId: string;

  let workspaceWideChannelId: string;
  let channelAId: string; // project A's channel
  let channelBId: string; // project B's channel

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f116-chat-${label}-${suffix}@example.com`,
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
    const otherClientUser = await makeUser("other-client");
    ownerId = owner.id;
    memberId = memberUser.id;
    viewerId = viewerUser.id;
    clientId = clientUser.id;
    otherClientId = otherClientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F116 chat test", slug: `f116-chat-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: otherClientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          // Deliberately 'workspace'-visibility: the pre-fix bug was that
          // ANY active member (including a non-project viewer) could
          // browse a workspace-visible project's channel. This project
          // being workspace-visible is what makes that failure mode
          // reachable, and is the honest common case (most projects are
          // workspace-visible, not private).
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectAId = await insertProject("Project A");
    projectBId = await insertProject("Project B");

    // memberId is on BOTH projects; viewerId is on NEITHER (workspace
    // viewer only); each client is on their own project only.
    await admin.from("project_members").insert([
      { project_id: projectAId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectBId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectBId, user_id: otherClientId, project_role: "member", added_by: ownerId },
    ]);

    // The workspace-wide channel (no project), auto-enroll-eligible for
    // ordinary team members but never for a client.
    const { data: wsChannel, error: wsChannelErr } = await admin
      .from("channels")
      .insert({
        workspace_id: workspaceId,
        project_id: null,
        kind: "channel",
        name: "general",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (wsChannelErr || !wsChannel) throw new Error(`ws channel: ${wsChannelErr?.message}`);
    workspaceWideChannelId = wsChannel.id;

    // Project channels, created + enrolled via the new RPC exactly the way
    // the app will call it (admin/service-role client only).
    const { data: chanA, error: chanAErr } = await admin.rpc("ensure_project_channel_atomic", {
      p_project_id: projectAId,
      p_created_by: ownerId,
    });
    if (chanAErr || !chanA) throw new Error(`ensure channel A: ${chanAErr?.message}`);
    channelAId = chanA as string;

    const { data: chanB, error: chanBErr } = await admin.rpc("ensure_project_channel_atomic", {
      p_project_id: projectBId,
      p_created_by: ownerId,
    });
    if (chanBErr || !chanB) throw new Error(`ensure channel B: ${chanBErr?.message}`);
    channelBId = chanB as string;

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
    _otherClientSession = await signIn(otherClientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("messages").delete().in("channel_id", [workspaceWideChannelId, channelAId, channelBId]);
    await admin.from("channel_members").delete().in("channel_id", [workspaceWideChannelId, channelAId, channelBId]);
    await admin.from("channels").delete().in("id", [workspaceWideChannelId, channelAId, channelBId]);
    await admin.from("project_members").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("projects").delete().in("id", [projectAId, projectBId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  describe("ensure_project_channel_atomic set up exactly one channel per project", () => {
    it("created one project channel each, distinct from the workspace-wide channel", () => {
      expect(channelAId).not.toBe(channelBId);
      expect(channelAId).not.toBe(workspaceWideChannelId);
    });

    it("is idempotent: a second call returns the same channel id and does not duplicate membership", async () => {
      const { data: again, error } = await admin.rpc("ensure_project_channel_atomic", {
        p_project_id: projectAId,
        p_created_by: ownerId,
      });
      expect(error).toBeNull();
      expect(again).toBe(channelAId);

      const { data: members, error: membersErr } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channelAId);
      expect(membersErr).toBeNull();
      const userIds = (members ?? []).map((m) => m.user_id);
      expect(new Set(userIds).size).toBe(userIds.length);
      expect(userIds.sort()).toEqual([memberId, clientId].sort());
    });

    it("is not callable by an ordinary authenticated session (service_role only)", async () => {
      const { error } = await clientSession.rpc("ensure_project_channel_atomic", {
        p_project_id: projectBId,
        p_created_by: clientId,
      });
      expect(error).not.toBeNull();
    });
  });

  describe("cross-project isolation (written and watched to fail first)", () => {
    it("a client cannot SELECT another project's channel by id", async () => {
      const { data, error } = await clientSession
        .from("channels")
        .select("id")
        .eq("id", channelBId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("a client cannot self-add into another project's channel by guessing its id", async () => {
      const { error } = await clientSession
        .from("channel_members")
        .insert({ channel_id: channelBId, user_id: clientId });
      expect(error).not.toBeNull();

      const { data: membership } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channelBId)
        .eq("user_id", clientId)
        .maybeSingle();
      expect(membership).toBeNull();
    });

    it("a client cannot read messages posted in another project's channel", async () => {
      await admin.from("messages").insert({
        channel_id: channelBId,
        sender_id: memberId,
        body_json: { type: "doc", content: [] },
        body_text: "internal to project B",
      });

      const { data, error } = await clientSession
        .from("messages")
        .select("id")
        .eq("channel_id", channelBId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("a client's search never surfaces a message from a channel they are not in", async () => {
      const { data: channelRows } = await clientSession
        .from("channels")
        .select("id")
        .eq("workspace_id", workspaceId);
      const visibleIds = (channelRows ?? []).map((c) => c.id);
      expect(visibleIds).not.toContain(channelBId);
      expect(visibleIds).not.toContain(workspaceWideChannelId);
    });
  });

  describe("a client cannot reach internal team chat", () => {
    it("cannot SELECT the workspace-wide channel", async () => {
      const { data, error } = await clientSession
        .from("channels")
        .select("id")
        .eq("id", workspaceWideChannelId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("cannot self-add into the workspace-wide channel", async () => {
      const { error } = await clientSession
        .from("channel_members")
        .insert({ channel_id: workspaceWideChannelId, user_id: clientId });
      expect(error).not.toBeNull();
    });
  });

  describe("a viewer who is not a project member cannot browse a client's channel", () => {
    it("cannot SELECT project A's channel despite the project being workspace-visible", async () => {
      const { data, error } = await viewerSession
        .from("channels")
        .select("id")
        .eq("id", channelAId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("cannot self-add into project A's channel", async () => {
      const { error } = await viewerSession
        .from("channel_members")
        .insert({ channel_id: channelAId, user_id: viewerId });
      expect(error).not.toBeNull();
    });
  });

  describe("a client CAN use their own project channel", () => {
    it("can SELECT their own project's channel", async () => {
      const { data, error } = await clientSession
        .from("channels")
        .select("id")
        .eq("id", channelAId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(channelAId);
    });

    it("can post a message, and the project team member sees it", async () => {
      const { data: inserted, error: insertError } = await clientSession
        .from("messages")
        .insert({
          channel_id: channelAId,
          sender_id: clientId,
          body_json: { type: "doc", content: [] },
          body_text: "hello from the client",
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();
      expect(inserted?.id).toBeTruthy();

      const { data: seenByMember, error: memberReadError } = await memberSession
        .from("messages")
        .select("id, body_text")
        .eq("id", inserted!.id)
        .maybeSingle();
      expect(memberReadError).toBeNull();
      expect(seenByMember?.body_text).toBe("hello from the client");
    });

    it("can see the channel's own member roster (their project team, not the whole workspace)", async () => {
      const { data, error } = await clientSession
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channelAId);
      expect(error).toBeNull();
      const userIds = (data ?? []).map((r) => r.user_id);
      expect(userIds).toContain(clientId);
      expect(userIds).toContain(memberId);
      // Never the other project's client or the pure workspace viewer --
      // both are strangers to this channel.
      expect(userIds).not.toContain(otherClientId);
      expect(userIds).not.toContain(viewerId);
    });

    it("cannot edit a staff member's message, but can edit (and delete) their own", async () => {
      const { data: staffMessage } = await admin
        .from("messages")
        .insert({
          channel_id: channelAId,
          sender_id: memberId,
          body_json: { type: "doc", content: [] },
          body_text: "staff note",
        })
        .select("id")
        .single();

      const { data: editResult, error: editError } = await clientSession
        .from("messages")
        .update({ body_text: "tampered" })
        .eq("id", staffMessage!.id)
        .select("id");
      expect(editError).toBeNull();
      // RLS silently filters the row rather than erroring -- zero rows
      // affected is the correct "you may not touch this" outcome here.
      expect(editResult ?? []).toHaveLength(0);

      const { data: unchanged } = await admin
        .from("messages")
        .select("body_text")
        .eq("id", staffMessage!.id)
        .single();
      expect(unchanged?.body_text).toBe("staff note");
    });
  });
});
