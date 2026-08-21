// Integration test for F015 (AS-007), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf and server-client mocking pattern
// established by tests/integration/create-workspace-owner.test.ts and
// tests/integration/rls-workspaces.test.ts.

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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

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

describe.skipIf(!haveAdminCreds)("inviteMember (F015: AS-007)", () => {
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
      email: `f015-${prefix}-${uniqueSuffix}@example.com`,
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
      .insert({ name: `F015 test ${uniqueSuffix}`, slug: `f015-${uniqueSuffix}` })
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

  it("AS-007: an owner can invite a user by email, creating an invited workspace_members row", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("owner");
    currentTestUserId = userId;

    const inviteEmail = `f015-invitee-${Date.now()}@example.com`;
    const result = await inviteMember(workspaceId, inviteEmail);

    expect(result).toEqual({ ok: true, invitedEmail: inviteEmail });

    const { data: row, error } = await adminClient
      .from("workspace_members")
      .select("status, invited_email, user_id, role")
      .eq("workspace_id", workspaceId)
      .eq("invited_email", inviteEmail)
      .single();

    expect(error).toBeNull();
    expect(row).toBeTruthy();
    expect(row!.status).toBe("invited");
    expect(row!.invited_email).toBe(inviteEmail);
    expect(row!.user_id).toBeNull();
  });

  it("AS-007: an admin can also invite a user by email", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("admin");
    currentTestUserId = userId;

    const inviteEmail = `f015-invitee-admin-${Date.now()}@example.com`;
    const result = await inviteMember(workspaceId, inviteEmail);

    expect(result).toEqual({ ok: true, invitedEmail: inviteEmail });
  });

  it("AS-007 (failure case): a plain member cannot invite — rejected server-side, not just UI-hidden", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("member");
    currentTestUserId = userId;

    const inviteEmail = `f015-invitee-rejected-${Date.now()}@example.com`;
    const result = await inviteMember(workspaceId, inviteEmail);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/permission/i);
    }

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("invited_email", inviteEmail)
      .maybeSingle();

    expect(row).toBeNull();
  });

  it("AS-007 (failure case): an unauthenticated caller cannot invite", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId } = await createWorkspaceWithMember("owner");
    currentTestUserId = null;

    const result = await inviteMember(workspaceId, `f015-noauth-${Date.now()}@example.com`);

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to invite a member.",
    });
  });

  it("AS-007 (failure case): inviting an email that is already invited is rejected cleanly, no duplicate row", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId } = await createWorkspaceWithMember("owner");
    currentTestUserId = userId;

    const inviteEmail = `f015-duplicate-invite-${Date.now()}@example.com`;

    const first = await inviteMember(workspaceId, inviteEmail);
    expect(first).toEqual({ ok: true, invitedEmail: inviteEmail });

    const second = await inviteMember(workspaceId, inviteEmail);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/already been invited/i);
    }

    const { data: rows } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("invited_email", inviteEmail);

    expect(rows).toHaveLength(1);
  });

  it("AS-007 (failure case): inviting an email that is already an active member is rejected cleanly", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId, userId: ownerId } = await createWorkspaceWithMember("owner");

    // Seed a second active member for this workspace using a real auth user
    // so the by-email lookup (for rows with no invited_email set) matches.
    const activeMemberUserId = await createThrowawayUser("active-target");
    const { data: activeUser } = await adminClient.auth.admin.getUserById(
      activeMemberUserId,
    );
    const activeMemberEmail = activeUser.user!.email!;
    const { error: seedErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: activeMemberUserId,
      role: "member",
      status: "active",
    });
    if (seedErr) {
      throw new Error(`Failed to seed active member: ${seedErr.message}`);
    }

    currentTestUserId = ownerId;
    const result = await inviteMember(workspaceId, activeMemberEmail);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already a member/i);
    }

    const { data: rows } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", activeMemberUserId);

    expect(rows).toHaveLength(1);
  });

  it("AS-007 (side effect): inviting in one workspace does not create or affect a row in another workspace", async () => {
    const { inviteMember } = await import("@/lib/actions/workspaces");
    const { workspaceId: workspaceA, userId } = await createWorkspaceWithMember("owner");
    const { workspaceId: workspaceB } = await createWorkspaceWithMember("owner");
    currentTestUserId = userId;

    const inviteEmail = `f015-scoped-${Date.now()}@example.com`;
    const result = await inviteMember(workspaceA, inviteEmail);
    expect(result).toEqual({ ok: true, invitedEmail: inviteEmail });

    const { data: rowsInB } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceB)
      .eq("invited_email", inviteEmail);

    expect(rowsInB).toHaveLength(0);
  });
});
