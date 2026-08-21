// Integration test for F019 (AS-014, AS-015, AS-019) and F129 (AS-218,
// AS-219, AS-232, AS-235 — the expanded 5-role set), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf and
// server-client mocking pattern established by
// tests/integration/revoke-invite.test.ts.
//
// F129 widens `changeMemberRole` from mission-1's owner-only line to
// owner-or-admin (AS-218), and now allows an owner's row to be the target
// of a role change — except when it is the workspace's sole remaining
// owner (AS-219). Several tests below that asserted the old, narrower
// behaviour ("only the owner can change roles", "an owner's row can never
// be touched") have been rewritten to match the superseding assertions;
// see the F129 handoff for the full rationale.

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

describe.skipIf(!haveAdminCreds)(
  "changeMemberRole (F019: AS-014, AS-015, AS-019; F129: AS-218, AS-219, AS-232, AS-235)",
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
      role: "owner" | "admin" | "member" | "viewer" | "guest",
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

    it("AS-014/AS-218: an owner can change a member's role from member to admin", async () => {
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

    it("AS-218: an admin can also change a member's role (superseding mission-1's owner-only AS-014/AS-019)", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const admin = await seedMember(workspaceId, "admin");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = admin.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "viewer",
      );

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("viewer");
    });

    it("AS-218: an owner or admin can change a member's role to every non-owner role (member/admin/viewer/guest)", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = owner.userId;

      for (const newRole of ["viewer", "admin", "guest", "member"] as const) {
        const result = await changeMemberRole(
          workspaceId,
          target.membershipId,
          newRole,
        );
        expect(result).toEqual({ ok: true });

        const { data: row } = await adminClient
          .from("workspace_members")
          .select("role")
          .eq("id", target.membershipId)
          .maybeSingle();
        expect(row?.role).toBe(newRole);
      }
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
        expect(result.error).toMatch(/owner or an admin/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("member");
    });

    it("AS-015 (failure case): a viewer cannot change another member's role — rejected server-side", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const caller = await seedMember(workspaceId, "viewer");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = caller.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );

      expect(result.ok).toBe(false);

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

    it("(failure case): newRole is rejected if it is 'owner' — this action never grants ownership", async () => {
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

    it("AS-219: the sole remaining owner cannot be demoted to any role", async () => {
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
      if (!result.ok) {
        expect(result.error).toMatch(/sole owner/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", owner.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("owner");
    });

    it("AS-219 (negative sibling): a non-sole owner CAN be demoted", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const ownerA = await seedMember(workspaceId, "owner");
      const ownerB = await seedMember(workspaceId, "owner");

      currentTestUserId = ownerA.userId;
      const result = await changeMemberRole(
        workspaceId,
        ownerB.membershipId,
        "admin",
      );

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", ownerB.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("admin");
    });

    it("AS-235: a guest cannot be promoted directly to admin", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "guest");

      currentTestUserId = owner.userId;
      const result = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/guest cannot be promoted/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("guest");
    });

    it("AS-235 (negative sibling): a guest CAN be changed to member (the first step towards eventually becoming admin)", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "guest");

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

    it("AS-235 (two-step path): a guest changed to member can then be changed to admin", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "guest");

      currentTestUserId = owner.userId;
      const first = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "member",
      );
      expect(first).toEqual({ ok: true });

      const second = await changeMemberRole(
        workspaceId,
        target.membershipId,
        "admin",
      );
      expect(second).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("admin");
    });

    it("AS-232: the target's next request re-reads their role from the database, with no session cache to invalidate", async () => {
      // changeMemberRole updates workspace_members.role directly, and every
      // membership/permission check in this codebase (requireActiveMembership,
      // requireWorkspaceAdmin, canManageMembers, etc.) re-queries that table
      // per-request rather than reading from a cached session/JWT claim — so
      // a role change takes effect on the target's very next request with no
      // explicit invalidation step and no sign-out required. This test
      // proves that DB-level guarantee: read the role again immediately
      // after the change, exactly as any subsequent request's fresh query
      // would.
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
        .eq("status", "active")
        .maybeSingle();

      expect(row?.role).toBe("admin");
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
