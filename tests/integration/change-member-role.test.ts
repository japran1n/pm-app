// Integration test for F019 (AS-014, AS-015, AS-019), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf and
// server-client mocking pattern established by
// tests/integration/revoke-invite.test.ts.

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

describe.skipIf(!haveAdminCreds)(
  "changeMemberRole (F019: AS-014, AS-015, AS-019)",
  () => {
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
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function createThrowawayUser(prefix: string) {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data, error } = await adminClient.auth.admin.createUser({
        email: `f019-${prefix}-${uniqueSuffix}@example.com`,
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
      const { data: workspace, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: `F019 test ${uniqueSuffix}`,
          slug: `f019-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !workspace) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      createdWorkspaceIds.push(workspace.id);
      return workspace.id as string;
    }

    async function seedMember(
      workspaceId: string,
      role: "owner" | "admin" | "member",
    ) {
      const userId = await createThrowawayUser(role);
      const { data, error } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          role,
          status: "active",
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed ${role} membership: ${error?.message}`);
      }
      return { membershipId: data.id as string, userId };
    }

    it("AS-014: an owner can change a member's role from member to admin", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = owner.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("admin");
    });

    it("AS-014: an owner can change a member's role from admin back to member", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "admin");

      currentTestUserId = owner.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "member",
      );

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });

    it("AS-015/AS-019 (failure case): an admin cannot change a member's role — rejected server-side even called directly", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const admin = await seedMember(workspaceId, "admin");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = admin.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/owner/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });

    it("AS-015 (failure case): a plain member cannot change another member's role — rejected server-side even called directly", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const caller = await seedMember(workspaceId, "member");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = caller.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/owner/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });

    it("(failure case): an unauthenticated caller cannot change a role", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const target = await seedMember(workspaceId, "member");
      currentTestUserId = null;

      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to change a member's role.",
      });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });

    it("(failure case): newRole is rejected if it is not 'member' or 'admin' (e.g. 'owner')", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = owner.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        // Intentionally passing an invalid value at the type boundary to
        // exercise the Zod-enforced rejection a bypassed UI could send.
        "owner" as unknown as "admin",
      );

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });

    it("(failure case): the owner's own row cannot be changed through this action", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");

      currentTestUserId = owner.userId;
      const result = await changeMemberRole(
        workspaceId,
        owner.membershipId,
        "admin",
      );

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", owner.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("owner");
    });

    it("(side effect): changing a role in one workspace does not affect a same-id-shaped membership in another workspace", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      const ownerA = await seedMember(workspaceA, "owner");
      const targetInB = await seedMember(workspaceB, "member");

      currentTestUserId = ownerA.userId;
      const result = await changeMemberRole(
        workspaceA,
        targetInB.membershipId,
        "admin",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/no longer exists/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", targetInB.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });
  },
);
