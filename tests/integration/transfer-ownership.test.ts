// Integration test for F130 (AS-233, AS-234) — atomic ownership transfer.
// Mirrors the loadDotEnv/skipIf and server-client mocking pattern
// established by tests/integration/change-member-role.test.ts.

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
    "F130: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
    rpc: async () => ({ data: null, error: null }),
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "transferOwnership (F130: AS-233, AS-234)",
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
        email: `f130-${prefix}-${uniqueSuffix}@example.com`,
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
          name: `F130 test ${uniqueSuffix}`,
          slug: `f130-${uniqueSuffix}`,
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
      status: "active" | "invited" = "active",
    ) {
      const userId = await createThrowawayUser(role);
      const insertRow: Record<string, unknown> = {
        workspace_id: workspaceId,
        role,
        status,
      };
      if (status === "active") {
        insertRow.user_id = userId;
      } else {
        // A pending invite row has no user_id yet in this schema
        // (mirrors inviteMember's own insert shape) — the invited_email
        // column carries identity instead. We still track a throwaway
        // user id for cleanup purposes even though it's never linked to
        // this particular row.
        insertRow.invited_email = `pending-${userId}@example.com`;
      }
      const { data, error } = await adminClient
        .from("workspace_members")
        .insert(insertRow)
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed ${role} membership: ${error?.message}`);
      }
      return { membershipId: data.id as string, userId };
    }

    it("AS-233: an owner can transfer ownership; the previous owner becomes an admin", async () => {
      const { transferOwnership } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = owner.userId;
      const result = await transferOwnership(workspaceId, target.userId);

      expect(result).toEqual({ ok: true });

      const { data: ownerRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", owner.membershipId)
        .maybeSingle();
      expect(ownerRow?.role).toBe("admin");

      const { data: targetRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();
      expect(targetRow?.role).toBe("owner");
    });

    it("(failure case): a non-owner (admin) cannot transfer ownership — rejected server-side", async () => {
      const { transferOwnership } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const admin = await seedMember(workspaceId, "admin");
      const target = await seedMember(workspaceId, "member");

      currentTestUserId = admin.userId;
      const result = await transferOwnership(workspaceId, target.userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/only the workspace owner/i);
      }

      const { data: ownerRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", owner.membershipId)
        .maybeSingle();
      expect(ownerRow?.role).toBe("owner");
    });

    it("AS-234: transferring to a removed (non-member) user is rejected, leaving both roles unchanged", async () => {
      const { transferOwnership } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");
      const removedTarget = await seedMember(workspaceId, "member");

      // Simulate removal (mirrors `remove_workspace_member`'s DELETE — the
      // row is gone entirely, exactly what a removed member's row looks
      // like after `removeMember` succeeds).
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("id", removedTarget.membershipId);

      currentTestUserId = owner.userId;
      const result = await transferOwnership(workspaceId, removedTarget.userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/active member/i);
      }

      const { data: ownerRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", owner.membershipId)
        .maybeSingle();
      expect(ownerRow?.role).toBe("owner");
    });

    it("AS-234: transferring to a pending/invited (not yet active) member is rejected, leaving both roles unchanged", async () => {
      const { transferOwnership } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");

      // A pending invite row has no user_id — create a throwaway user
      // separately and insert an "invited" row keyed to that user id via
      // invited_email, then attempt to transfer to that user's id (the
      // same shape a bypassed/forged client call would send).
      const pendingUserId = await createThrowawayUser("pending-target");
      const { data: pendingRow, error: pendingErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          role: "member",
          status: "invited",
          invited_email: `f130-pending-${pendingUserId}@example.com`,
        })
        .select("id")
        .single();
      if (pendingErr || !pendingRow) {
        throw new Error(
          `Failed to seed pending invite: ${pendingErr?.message}`,
        );
      }

      currentTestUserId = owner.userId;
      const result = await transferOwnership(workspaceId, pendingUserId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/active member/i);
      }

      const { data: ownerRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", owner.membershipId)
        .maybeSingle();
      expect(ownerRow?.role).toBe("owner");

      const { data: pendingRowAfter } = await adminClient
        .from("workspace_members")
        .select("role, status")
        .eq("id", pendingRow.id)
        .maybeSingle();
      expect(pendingRowAfter?.status).toBe("invited");
      expect(pendingRowAfter?.role).toBe("member");
    });

    it("(atomicity) a mid-transaction DB-level failure after the lock is taken leaves the original owner's row untouched, not partially updated", async () => {
      // Directly exercises the `transfer_workspace_ownership` RPC (not the
      // Server Action) to prove the underlying atomicity guarantee: the
      // workspace is seeded into an anomalous pre-existing state (two
      // active owner rows — something the app itself would never produce,
      // but which could theoretically exist from a data issue elsewhere),
      // which trips the RPC's own internal "exactly one active owner
      // afterward" invariant check and forces it to raise *after* both
      // UPDATE statements have already run inside the same transaction.
      // Because there is no exception handler in the function body,
      // Postgres rolls back the whole implicit transaction — so if
      // atomicity holds, the original (locked) owner row must still read
      // 'owner' afterward, not 'admin' (a torn write), and the extra
      // pre-existing owner row must be untouched too.
      const workspaceId = await createWorkspace();
      const ownerA = await seedMember(workspaceId, "owner");
      const ownerB = await seedMember(workspaceId, "owner");
      const target = await seedMember(workspaceId, "member");

      const { data: rpcRows, error: rpcError } = await adminClient.rpc(
        "transfer_workspace_ownership",
        {
          p_workspace_id: workspaceId,
          p_new_owner_user_id: target.userId,
        },
      );

      // The RPC itself raises a Postgres exception (not a returned "false"
      // row) once the invariant check fails, so the call surfaces as an
      // error from PostgREST, not a `{ transferred: false }` row.
      expect(rpcError).toBeTruthy();
      expect(rpcRows).toBeFalsy();

      const { data: ownerARow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", ownerA.membershipId)
        .maybeSingle();
      // ownerA is whichever of the two owner rows the RPC's
      // `order by created_at asc limit 1` picked and locked — it must
      // still be 'owner' (not 'admin'), proving the first UPDATE was
      // rolled back along with everything else.
      expect(ownerARow?.role).toBe("owner");

      const { data: ownerBRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", ownerB.membershipId)
        .maybeSingle();
      expect(ownerBRow?.role).toBe("owner");

      const { data: targetRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", target.membershipId)
        .maybeSingle();
      // The target's role must still be 'member' — the second UPDATE
      // (target -> owner) was rolled back too, not left half-applied.
      expect(targetRow?.role).toBe("member");
    });

    it("(side effect): transferring ownership in one workspace does not affect a same-id-shaped membership in another workspace", async () => {
      const { transferOwnership } = await import("@/lib/actions/workspaces");
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      const ownerA = await seedMember(workspaceA, "owner");
      const targetInB = await seedMember(workspaceB, "member");

      currentTestUserId = ownerA.userId;
      const result = await transferOwnership(workspaceA, targetInB.userId);

      expect(result.ok).toBe(false);

      const { data: targetInBRow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", targetInB.membershipId)
        .maybeSingle();
      expect(targetInBRow?.role).toBe("member");

      const { data: ownerARow } = await adminClient
        .from("workspace_members")
        .select("role")
        .eq("id", ownerA.membershipId)
        .maybeSingle();
      expect(ownerARow?.role).toBe("owner");
    });
  },
);
