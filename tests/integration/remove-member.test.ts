// Integration test for F020 (AS-016, AS-017, AS-018), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf and
// server-client mocking pattern established by
// tests/integration/change-member-role.test.ts.

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
  "removeMember (F020: AS-016, AS-017, AS-018)",
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
        email: `f020-${prefix}-${uniqueSuffix}@example.com`,
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
          name: `F020 test ${uniqueSuffix}`,
          slug: `f020-${uniqueSuffix}`,
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

    it("AS-016: an owner can remove a regular member", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = owner.userId;
      const result = await removeMember(workspaceId, target.membershipId);

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row).toBeNull();
    });

    it("AS-016: an admin can remove a regular member", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const admin = await seedMember(workspaceId, "admin");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = admin.userId;
      const result = await removeMember(workspaceId, target.membershipId);

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row).toBeNull();
    });

    it("AS-018 (failure case): the sole owner cannot be removed", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const admin = await seedMember(workspaceId, "admin");

      // The admin attempts to remove the sole owner; must be rejected
      // regardless of the caller's own role.
      currentTestUserId = admin.userId;
      const result = await removeMember(workspaceId, owner.membershipId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/sole owner/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id, role")
        .eq("id", owner.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("owner");
    });

    it("AS-018: the sole owner cannot remove/demote themselves", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");

      // The sole owner attempts to remove their own membership row.
      currentTestUserId = owner.userId;
      const result = await removeMember(workspaceId, owner.membershipId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/sole owner/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id, role, status")
        .eq("id", owner.membershipId)
        .maybeSingle();

      expect(row?.role).toBe("owner");
      expect(row?.status).toBe("active");
    });

    it("AS-018 (concurrency): two simultaneous removeMember calls against a 2-owner workspace leave at least one owner", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const ownerA = await seedMember(workspaceId, "owner");
      const ownerB = await seedMember(workspaceId, "owner");
      const admin = await seedMember(workspaceId, "admin");

      // A single admin caller fires two removeMember calls at the same
      // time, targeting the two different owner rows. (The mocked
      // getUser() reads a single shared `currentTestUserId`, so the two
      // concurrent calls must share one caller identity — the race being
      // tested is in the DB-side count-and-delete, not in caller
      // resolution.) Before the F094 fix (check-then-act with no
      // atomicity), both calls could read "2 active owners" before either
      // delete committed, both pass the guard, and both succeed — leaving
      // zero owners. The atomic `remove_workspace_member` RPC (row-locking
      // via `SELECT ... FOR UPDATE`) must serialize these so at most one
      // succeeds.
      currentTestUserId = admin.userId;
      const callA = removeMember(workspaceId, ownerA.membershipId);
      const callB = removeMember(workspaceId, ownerB.membershipId);

      const [resultA, resultB] = await Promise.all([callA, callB]);

      const successCount = [resultA, resultB].filter((r) => r.ok).length;
      expect(successCount).toBeLessThanOrEqual(1);

      const { data: remainingOwners } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .eq("status", "active");

      expect((remainingOwners ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("AS-018: a workspace with multiple owners allows removing one of them", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const ownerA = await seedMember(workspaceId, "owner");
      const ownerB = await seedMember(workspaceId, "owner");

      currentTestUserId = ownerA.userId;
      const result = await removeMember(workspaceId, ownerB.membershipId);

      expect(result).toEqual({ ok: true });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("id", ownerB.membershipId)
        .maybeSingle();

      expect(row).toBeNull();
    });

    it("(failure case): a plain member cannot remove anyone — rejected server-side even called directly", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const caller = await seedMember(workspaceId, "member");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = caller.userId;
      const result = await removeMember(workspaceId, target.membershipId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/permission/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row).not.toBeNull();
    });

    it("(failure case): an unauthenticated caller cannot remove a member", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const target = await seedMember(workspaceId, "member");
      currentTestUserId = null;

      const result = await removeMember(workspaceId, target.membershipId);

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to remove a member.",
      });

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("id", target.membershipId)
        .maybeSingle();

      expect(row).not.toBeNull();
    });

    it("AS-017: a removed member's row no longer resolves as active membership (loses access on next request)", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = owner.userId;
      const result = await removeMember(workspaceId, target.membershipId);
      expect(result).toEqual({ ok: true });

      // AS-017: the removed member's next request re-checks membership via
      // requireActiveMembership-style lookups; the row is gone, so any such
      // lookup finds nothing and access is denied.
      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", target.userId)
        .eq("status", "active")
        .maybeSingle();

      expect(row).toBeNull();
    });

    it("(side effect): removing a member in one workspace does not affect a same-id-shaped membership in another workspace", async () => {
      const { removeMember } = await import("@/lib/actions/workspaces");
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      const ownerA = await seedMember(workspaceA, "owner");
      const targetInB = await seedMember(workspaceB, "member");

      currentTestUserId = ownerA.userId;
      const result = await removeMember(workspaceA, targetInB.membershipId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/no longer exists/i);
      }

      const { data: row } = await adminClient
        .from("workspace_members")
        .select("id")
        .eq("id", targetInB.membershipId)
        .maybeSingle();

      expect(row).not.toBeNull();
    });
  },
);
