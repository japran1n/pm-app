// Integration test for the team 1:1 direct-message feature
// (supabase/migrations/20261108010000_dm_find_or_create.sql +
// lib/actions/chat-channels.ts's findOrCreateDirectMessage). Same
// convention as tests/integration/scope-documents-rls.test.ts: real
// signed-in sessions against PostgREST, pooled identities (F126) instead
// of minting fresh auth users.
//
// Covers:
//   - find_or_create_dm_channel_atomic is idempotent: calling it twice for
//     the same pair (in either argument order) returns the SAME channel id,
//     never a second DM;
//   - the two DM members both see the channel (channel_members RLS) and
//     can exchange messages;
//   - a workspace outsider cannot see the DM channel, its members, or its
//     messages, even by guessing the channel id;
//   - find_or_create_dm_channel_atomic is not directly callable by an
//     ordinary authenticated session (service_role only, mirrors
//     ensure_project_channel_atomic's own grant).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPoolIdentity, getPoolSession } from "../helpers/auth";

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

const FUNCTION_NOT_FOUND_OR_DENIED = ["PGRST202", "42883", "42501"];

describe.skipIf(!haveCreds)("team 1:1 DM find-or-create + RLS", () => {
  let admin: SupabaseClient;
  let aSession: SupabaseClient;
  let bSession: SupabaseClient;
  let outsiderSession: SupabaseClient;

  let workspaceId: string;
  let aId: string;
  let bId: string;
  let outsiderId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Pool slots: 4 = user A, 5 = user B (the DM pair), 6 = an outsider
    // who is also an active workspace member but not part of the DM.
    const aUser = await getPoolIdentity(4);
    const bUser = await getPoolIdentity(5);
    const outsiderUser = await getPoolIdentity(6);
    aId = aUser.id;
    bId = bUser.id;
    outsiderId = outsiderUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "DM test", slug: `dm-test-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: aId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: bId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: outsiderId, role: "member", status: "active" },
    ]);

    aSession = await getPoolSession(4);
    bSession = await getPoolSession(5);
    outsiderSession = await getPoolSession(6);
  }, 60_000);

  afterAll(async () => {
    if (!admin || !workspaceId) return;
    // `messages`/`channel_members` both cascade-delete via `channels`'
    // own FK (on delete cascade), so deleting the channels row is enough.
    await admin.from("channels").delete().eq("workspace_id", workspaceId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
  }, 60_000);

  it("AS: find_or_create_dm_channel_atomic creates a DM channel with exactly the two members", async () => {
    const { data: channelId, error } = await admin.rpc("find_or_create_dm_channel_atomic", {
      p_workspace_id: workspaceId,
      p_user_a: aId,
      p_user_b: bId,
      p_created_by: aId,
    });

    expect(error).toBeNull();
    expect(channelId).toBeTruthy();

    const { data: channel } = await admin
      .from("channels")
      .select("id, kind, workspace_id")
      .eq("id", channelId as string)
      .single();
    expect(channel?.kind).toBe("dm");
    expect(channel?.workspace_id).toBe(workspaceId);

    const { data: members } = await admin
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId as string);
    const memberIds = (members ?? []).map((m) => m.user_id).sort();
    expect(memberIds).toEqual([aId, bId].sort());
  });

  it("AS: calling find-or-create again for the same pair (either argument order) returns the SAME channel, not a duplicate", async () => {
    const { data: firstId } = await admin.rpc("find_or_create_dm_channel_atomic", {
      p_workspace_id: workspaceId,
      p_user_a: aId,
      p_user_b: bId,
      p_created_by: aId,
    });

    const { data: secondId, error: secondError } = await admin.rpc(
      "find_or_create_dm_channel_atomic",
      {
        p_workspace_id: workspaceId,
        p_user_a: bId,
        p_user_b: aId,
        p_created_by: bId,
      },
    );

    expect(secondError).toBeNull();
    expect(secondId).toBe(firstId);

    const { count } = await admin
      .from("channels")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("kind", "dm");
    expect(count).toBe(1);
  });

  it("AS: both DM members can send and read messages in their DM channel", async () => {
    const { data: channelId } = await admin.rpc("find_or_create_dm_channel_atomic", {
      p_workspace_id: workspaceId,
      p_user_a: aId,
      p_user_b: bId,
      p_created_by: aId,
    });

    const { error: sendError } = await aSession.from("messages").insert({
      channel_id: channelId as string,
      sender_id: aId,
      body_json: { type: "doc", content: [] },
    });
    expect(sendError).toBeNull();

    const { data: seenByB, error: readError } = await bSession
      .from("messages")
      .select("id")
      .eq("channel_id", channelId as string);
    expect(readError).toBeNull();
    expect((seenByB ?? []).length).toBeGreaterThan(0);
  });

  it("AS: a workspace member who is not part of the DM cannot see the channel, its members, or its messages", async () => {
    const { data: channelId } = await admin.rpc("find_or_create_dm_channel_atomic", {
      p_workspace_id: workspaceId,
      p_user_a: aId,
      p_user_b: bId,
      p_created_by: aId,
    });

    const { data: channelSeen } = await outsiderSession
      .from("channels")
      .select("id")
      .eq("id", channelId as string)
      .maybeSingle();
    expect(channelSeen).toBeNull();

    const { data: membersSeen } = await outsiderSession
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelId as string);
    expect(membersSeen ?? []).toEqual([]);

    const { data: messagesSeen } = await outsiderSession
      .from("messages")
      .select("id")
      .eq("channel_id", channelId as string);
    expect(messagesSeen ?? []).toEqual([]);
  });

  it("AS: an outsider cannot self-add into the DM channel by guessing its id", async () => {
    const { data: channelId } = await admin.rpc("find_or_create_dm_channel_atomic", {
      p_workspace_id: workspaceId,
      p_user_a: aId,
      p_user_b: bId,
      p_created_by: aId,
    });

    const { error } = await outsiderSession.from("channel_members").insert({
      channel_id: channelId as string,
      user_id: outsiderId,
    });
    expect(error).not.toBeNull();
  });

  it("find_or_create_dm_channel_atomic is service_role-only, not callable by an ordinary authenticated session", async () => {
    const { error } = await aSession.rpc("find_or_create_dm_channel_atomic", {
      p_workspace_id: workspaceId,
      p_user_a: aId,
      p_user_b: bId,
      p_created_by: aId,
    });
    expect(error).not.toBeNull();
    expect(FUNCTION_NOT_FOUND_OR_DENIED).toContain(error?.code);
  });
});
