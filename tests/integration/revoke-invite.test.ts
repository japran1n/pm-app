// Integration test for F018 (AS-024), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf and server-client
// mocking pattern established by tests/integration/invite-member.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

let currentTestUserId: string | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
  }),
}));

describe.skipIf(!haveAdminCreds)("revokeInvite (F018: AS-024)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(() => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  beforeEach(() => {
    currentTestUserId = null;
  });

  afterAll(async () => {
    for (const workspaceId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  async function createThrowawayUser(prefix: string) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email: `f018-${prefix}-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message}`);
    }
    createdUserIds.push(data.user.id);
    return data.user.id;
  }

  async function createWorkspaceWithMember(
    role: "owner" | "admin" | "member",
  ) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: workspace, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: `F018 test ${uniqueSuffix}`, slug: `f018-${uniqueSuffix}` })
      .select("id, slug")
      .single();
    if (wsErr || !workspace) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    createdWorkspaceIds.push(workspace.id);

    const userId = await createThrowawayUser(role);
    const { error: memberErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: userId,
      role,
      status: "active",
    });
    if (memberErr) {
      throw new Error(`Failed to seed ${role} membership: ${memberErr.message}`);
    }

    return { workspaceId: workspace.id, userId };
  }

  async function seedPendingInvite(workspaceId: string, email: string) {
    const { data, error } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: null,
        invited_email: email,
        role: "member",
        status: "invited",
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Failed to seed pending invite: ${error?.message}`);
    }
    return data.id as string;
  }

  it("AS-024: an owner can revoke a pending invite, deleting the row", async () => {
    const { revokeInvite } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("owner");
    currentTestUserId = userId;

    const inviteEmail = `f018-invitee-${Date.now()}@example.com`;
    const inviteId = await seedPendingInvite(workspaceId, inviteEmail);

    const result = await revokeInvite(workspaceId, inviteId);
    expect(result).toEqual({ ok: true });

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("id", inviteId)
      .maybeSingle();

    expect(row).toBeNull();
  });

  it("AS-024: an admin can also revoke a pending invite", async () => {
    const { revokeInvite } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("admin");
    currentTestUserId = userId;

    const inviteEmail = `f018-invitee-admin-${Date.now()}@example.com`;
    const inviteId = await seedPendingInvite(workspaceId, inviteEmail);

    const result = await revokeInvite(workspaceId, inviteId);
    expect(result).toEqual({ ok: true });

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("id", inviteId)
      .maybeSingle();

    expect(row).toBeNull();
  });

  it("AS-024 (failure case): a plain member cannot revoke — rejected server-side, not just UI-hidden", async () => {
    const { revokeInvite } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("member");
    currentTestUserId = userId;

    const inviteEmail = `f018-invitee-rejected-${Date.now()}@example.com`;
    const inviteId = await seedPendingInvite(workspaceId, inviteEmail);

    const result = await revokeInvite(workspaceId, inviteId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("id", inviteId)
      .maybeSingle();

    expect(row).not.toBeNull();
  });

  it("AS-024 (failure case): an unauthenticated caller cannot revoke", async () => {
    const { revokeInvite } = await import("@/lib/actions/workspaces");
    const { workspaceId } = await createWorkspaceWithMember("owner");
    currentTestUserId = null;

    const inviteEmail = `f018-noauth-${Date.now()}@example.com`;
    const inviteId = await seedPendingInvite(workspaceId, inviteEmail);

    const result = await revokeInvite(workspaceId, inviteId);

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to revoke an invite.",
    });

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("id", inviteId)
      .maybeSingle();

    expect(row).not.toBeNull();
  });

  it("AS-024 (failure case): revoking an already-active member row is rejected, not deleted", async () => {
    const { revokeInvite } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId: ownerId } = await createWorkspaceWithMember("owner");
    const { userId: otherActiveUserId } = await createWorkspaceWithMember("member");

    // Seed a second active (non-invited) member row directly in the owner's
    // workspace so we can attempt to "revoke" it — this must never delete
    // an active membership (that's F020's scope, not F018's).
    const { data: activeRow, error: seedErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: otherActiveUserId,
        role: "member",
        status: "active",
      })
      .select("id")
      .single();
    if (seedErr || !activeRow) {
      throw new Error(`Failed to seed active member row: ${seedErr?.message}`);
    }

    currentTestUserId = ownerId;
    const result = await revokeInvite(workspaceId, activeRow.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/pending invites/i);
    }

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id, status")
      .eq("id", activeRow.id)
      .maybeSingle();

    expect(row).not.toBeNull();
    expect(row!.status).toBe("active");
  });

  it("AS-024 (side effect): revoking an invite in one workspace does not affect a same-id-shaped invite in another workspace", async () => {
    const { revokeInvite } = await import("@/lib/actions/workspaces");
    const { workspaceId: workspaceA, userId } = await createWorkspaceWithMember("owner");
    const { workspaceId: workspaceB } = await createWorkspaceWithMember("owner");
    currentTestUserId = userId;

    const inviteEmail = `f018-scoped-${Date.now()}@example.com`;
    const inviteIdInB = await seedPendingInvite(workspaceB, inviteEmail);

    // Attempt to revoke workspace B's invite while acting as workspace A's
    // owner, passing workspace A's id — must be rejected, and must not
    // touch workspace B's row.
    const result = await revokeInvite(workspaceA, inviteIdInB);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no longer exists/i);
    }

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("id", inviteIdInB)
      .maybeSingle();

    expect(row).not.toBeNull();
  });
});
