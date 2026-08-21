// Integration test for F126 (AS-215, AS-238), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf and admin-client seeding
// pattern established by tests/integration/invite-member.test.ts and
// tests/integration/create-workspace-owner.test.ts.
//
// AS-215 predates the guest role: it asserts a member holds one of owner,
// admin, member, or viewer. This suite re-confirms all four original values
// still insert cleanly under the widened CHECK constraint (no regression),
// plus that 'guest' is now also accepted (F126 only widens the domain —
// guest's actual scoping/enforcement rules land in F134) and that a
// still-invalid value is still rejected.
//
// AS-238: an invite specifies the role granted on acceptance. Verified by
// calling inviteMember with each grantable role and reading back the row's
// `role` column — since accept (activateInvitedMemberships) only flips
// status/user_id and never touches `role`, the value written at invite time
// is exactly what is granted on acceptance.

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
    "F126: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveAdminCreds)("workspace role expansion (F126)", () => {
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
      email: `f126-${prefix}-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message}`);
    }
    createdUserIds.push(data.user.id);
    return data.user.id;
  }

  async function createWorkspace() {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: workspace, error } = await adminClient
      .from("workspaces")
      .insert({ name: `F126 test ${uniqueSuffix}`, slug: `f126-${uniqueSuffix}` })
      .select("id, slug")
      .single();
    if (error || !workspace) {
      throw new Error(`Failed to create test workspace: ${error?.message}`);
    }
    createdWorkspaceIds.push(workspace.id);
    return workspace.id as string;
  }

  describe("AS-215: workspace_members.role CHECK constraint", () => {
    it.each(["owner", "admin", "member", "viewer"] as const)(
      "AS-215: the original role '%s' is still accepted (no regression from widening)",
      async (role) => {
        const workspaceId = await createWorkspace();
        const userId = await createThrowawayUser(`orig-${role}`);

        const { error } = await adminClient.from("workspace_members").insert({
          workspace_id: workspaceId,
          user_id: userId,
          role,
          status: "active",
        });

        expect(error).toBeNull();
      },
    );

    it("AS-215: the new 'guest' role value is now accepted by the CHECK constraint", async () => {
      const workspaceId = await createWorkspace();
      const userId = await createThrowawayUser("guest");

      const { error } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "guest",
        status: "active",
      });

      expect(error).toBeNull();
    });

    it("AS-215 (negative): a role value outside the widened set is still rejected", async () => {
      const workspaceId = await createWorkspace();
      const userId = await createThrowawayUser("bogus");

      const { error } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "superadmin",
        status: "active",
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/check constraint|violates/i);
    });
  });

  describe("AS-238: an invite specifies the role granted on acceptance", () => {
    async function createWorkspaceWithOwner() {
      const workspaceId = await createWorkspace();
      const ownerId = await createThrowawayUser("owner");
      const { error } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        role: "owner",
        status: "active",
      });
      if (error) {
        throw new Error(`Failed to seed owner: ${error.message}`);
      }
      return { workspaceId, ownerId };
    }

    it.each(["admin", "member", "viewer"] as const)(
      "AS-238: inviting with role '%s' creates an invited row that grants that role",
      async (role) => {
        const { inviteMember } = await import("@/lib/actions/workspaces");
        const { workspaceId, ownerId } = await createWorkspaceWithOwner();
        currentTestUserId = ownerId;

        const inviteEmail = `f126-invitee-${role}-${Date.now()}@example.com`;
        const result = await inviteMember(workspaceId, inviteEmail, role);

        expect(result).toEqual({ ok: true, invitedEmail: inviteEmail });

        const { data: row, error } = await adminClient
          .from("workspace_members")
          .select("role, status")
          .eq("workspace_id", workspaceId)
          .eq("invited_email", inviteEmail)
          .single();

        expect(error).toBeNull();
        expect(row!.role).toBe(role);
        expect(row!.status).toBe("invited");
      },
    );

    it("AS-238: omitting the role defaults the invite to 'member' (backward compatible)", async () => {
      const { inviteMember } = await import("@/lib/actions/workspaces");
      const { workspaceId, ownerId } = await createWorkspaceWithOwner();
      currentTestUserId = ownerId;

      const inviteEmail = `f126-invitee-default-${Date.now()}@example.com`;
      const result = await inviteMember(workspaceId, inviteEmail);

      expect(result).toEqual({ ok: true, invitedEmail: inviteEmail });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("invited_email", inviteEmail)
        .single();

      expect(row!.role).toBe("member");
    });

    it("AS-238: the granted role survives acceptance — activation only flips status/user_id", async () => {
      const { inviteMember } = await import("@/lib/actions/workspaces");
      const { activateInvitedMemberships } = await import(
        "@/lib/actions/invites"
      );
      const { workspaceId, ownerId } = await createWorkspaceWithOwner();
      currentTestUserId = ownerId;

      const inviteEmail = `f126-invitee-accept-${Date.now()}@example.com`;
      const invited = await inviteMember(workspaceId, inviteEmail, "viewer");
      expect(invited).toEqual({ ok: true, invitedEmail: inviteEmail });

      const acceptingUserId = await createThrowawayUser("accepting");
      const activated = await activateInvitedMemberships(
        acceptingUserId,
        inviteEmail,
      );
      expect(activated).toEqual([{ workspaceId }]);

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role, status, user_id")
        .eq("workspace_id", workspaceId)
        .eq("invited_email", inviteEmail)
        .single();

      expect(row!.role).toBe("viewer");
      expect(row!.status).toBe("active");
      expect(row!.user_id).toBe(acceptingUserId);
    });
  });
});
