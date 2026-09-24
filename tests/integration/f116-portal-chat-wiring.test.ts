// Integration test for F116 (docs/client-portal-phase-2-plan.md item A):
// the two real Server Action call sites that create/backfill a project's
// chat channel -- `setPortalEnabled` (lib/actions/portal-settings.ts) and
// `activateInvitedMemberships` (lib/actions/invites.ts). Drives the ACTUAL
// functions against a real signed-in session, same convention as
// tests/integration/f080-portal-settings-authz.test.ts (which this file
// sits next to), rather than asserting against a mocked query builder --
// this task's own instruction: "a previous security round in this project
// found that the mocked Server Action path had correct checks while the
// PostgREST path did not."

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

// SEC audit 2026-09-24: invites are no longer auto-activated at sign-in;
// the invitee explicitly accepts each one. This helper performs that
// explicit accept for every invite pending on `email` (what clicking
// Accept on each row of /invites does).
async function acceptPendingInvites(userId: string, email: string) {
  const { listPendingInvites, acceptInviteForUser } = await import("@/lib/actions/invites");
  const identity = { userId, email: email.toLowerCase() };
  const pending = await listPendingInvites(identity);
  const results = await Promise.all(pending.map((invite) => acceptInviteForUser(invite.id, identity)));
  return results.flatMap((result) => (result.ok ? [{ workspaceId: result.workspaceId }] : []));
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "F116: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

let currentSession: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSession,
}));

describe.skipIf(!haveCreds)("F116: portal-chat wiring (real Server Actions)", () => {
  let admin: SupabaseClient;
  let ownerSession: SupabaseClient;

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
        email: `f116-wiring-${label}-${suffix}@example.com`,
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
      .insert({ name: "F116 wiring test", slug: `f116-wiring-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      // clientId is intentionally NOT added here -- the second test below
      // exercises activateInvitedMemberships turning a pending invite row
      // into this exact user's first active membership, matching the real
      // sign-in-after-invite flow.
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "Wiring project",
        visibility: "workspace",
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    await admin
      .from("project_members")
      .insert([{ project_id: projectId, user_id: memberId, project_role: "lead", added_by: ownerId }]);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    ownerSession = await signIn(owner.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("channel_members").delete().eq("channel_id", channelIdRef.current ?? "00000000-0000-0000-0000-000000000000");
    if (channelIdRef.current) {
      await admin.from("channels").delete().eq("id", channelIdRef.current);
    }
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // Mutable ref so afterAll can clean up whatever channel the real action
  // actually created, without re-deriving it.
  const channelIdRef: { current: string | null } = { current: null };

  it("setPortalEnabled(true) creates the project's channel and enrolls its current team", async () => {
    currentSession = ownerSession;
    const { setPortalEnabled } = await import("@/lib/actions/portal-settings");

    const result = await setPortalEnabled(projectId, true);
    expect(result.ok).toBe(true);

    const { data: channel, error } = await admin
      .from("channels")
      .select("id")
      .eq("project_id", projectId)
      .eq("kind", "channel")
      .maybeSingle();
    expect(error).toBeNull();
    expect(channel?.id).toBeTruthy();
    channelIdRef.current = channel!.id as string;

    const { data: members } = await admin
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelIdRef.current!);
    expect((members ?? []).map((m) => m.user_id)).toEqual([memberId]);
  });

  it("activateInvitedMemberships backfills a newly-accepted client onto the already-existing channel", async () => {
    // Simulates the invite-accept path directly against the row shape
    // activateInvitedMemberships reads, rather than the full magic-link
    // flow -- same scope as this function's own existing unit coverage
    // elsewhere in the suite.
    const { data: inviteRow, error: inviteErr } = await admin
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: null,
        role: "client",
        status: "invited",
        invited_email: "f116-wiring-invitee@example.com",
        invited_project_id: projectId,
      })
      .select("id")
      .single();
    expect(inviteErr).toBeNull();

    await acceptPendingInvites(clientId, "f116-wiring-invitee@example.com");

    const { data: members, error } = await admin
      .from("channel_members")
      .select("user_id")
      .eq("channel_id", channelIdRef.current!);
    expect(error).toBeNull();
    const userIds = (members ?? []).map((m) => m.user_id);
    expect(userIds).toContain(clientId);
    expect(userIds).toContain(memberId);

    await admin.from("workspace_members").delete().eq("id", inviteRow!.id);
  });
});
