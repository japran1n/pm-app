// Integration test for F021 (AS-020, AS-021), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf, `next/navigation`
// redirect-mock, and server-client mocking pattern established by
// tests/integration/create-workspace-owner.test.ts and
// tests/integration/remove-member.test.ts.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

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
  "deleteWorkspace (F021: AS-020, AS-021)",
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
        email: `f021-${prefix}-${uniqueSuffix}@example.com`,
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
          name: `F021 test ${uniqueSuffix}`,
          slug: `f021-${uniqueSuffix}`,
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

    it("AS-020/AS-021: the owner can soft-delete a workspace (deleted_at is set, row is not removed)", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");

      currentTestUserId = owner.userId;

      // No other active membership exists, so this should redirect to
      // /onboarding — deleteWorkspace never resolves normally on success.
      await expect(deleteWorkspace(workspaceId)).rejects.toThrow(
        "NEXT_REDIRECT:/onboarding",
      );

      const { data: row } = await adminClient
        .from("workspaces")
        .select("id, deleted_at")
        .eq("id", workspaceId)
        .maybeSingle();

      expect(row).not.toBeNull();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-020: after soft-deleting, the caller is redirected to their next remaining workspace rather than /onboarding when one exists", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceToDelete = await createWorkspace();
      const otherWorkspace = await createWorkspace();

      const userId = await createThrowawayUser("multi");
      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceToDelete,
            user_id: userId,
            role: "owner",
            status: "active",
          },
          {
            workspace_id: otherWorkspace,
            user_id: userId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberErr) throw new Error(memberErr.message);

      const { data: otherWs } = await adminClient
        .from("workspaces")
        .select("slug")
        .eq("id", otherWorkspace)
        .single();

      currentTestUserId = userId;

      await expect(deleteWorkspace(workspaceToDelete)).rejects.toThrow(
        `NEXT_REDIRECT:/w/${otherWs!.slug}`,
      );

      const { data: row } = await adminClient
        .from("workspaces")
        .select("deleted_at")
        .eq("id", workspaceToDelete)
        .maybeSingle();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-020 (failure case): a non-owner (admin) is rejected server-side even called directly", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const admin = await seedMember(workspaceId, "admin");

      currentTestUserId = admin.userId;
      const result = await deleteWorkspace(workspaceId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/only the workspace owner/i);
      }

      const { data: row } = await adminClient
        .from("workspaces")
        .select("deleted_at")
        .eq("id", workspaceId)
        .maybeSingle();
      expect(row?.deleted_at).toBeNull();
    });

    it("AS-020 (failure case): a plain member is rejected server-side even called directly", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const member = await seedMember(workspaceId, "member");

      currentTestUserId = member.userId;
      const result = await deleteWorkspace(workspaceId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/only the workspace owner/i);
      }

      const { data: row } = await adminClient
        .from("workspaces")
        .select("deleted_at")
        .eq("id", workspaceId)
        .maybeSingle();
      expect(row?.deleted_at).toBeNull();
    });

    it("(failure case): an unauthenticated caller cannot delete a workspace", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = null;

      const result = await deleteWorkspace(workspaceId);

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to delete a workspace.",
      });

      const { data: row } = await adminClient
        .from("workspaces")
        .select("deleted_at")
        .eq("id", workspaceId)
        .maybeSingle();
      expect(row?.deleted_at).toBeNull();
    });

    it("AS-021 (side effect): soft-deleting one workspace does not affect another workspace's row", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      const owner = await seedMember(workspaceA, "owner");

      currentTestUserId = owner.userId;
      await expect(deleteWorkspace(workspaceA)).rejects.toThrow(
        "NEXT_REDIRECT:/onboarding",
      );

      const { data: rowB } = await adminClient
        .from("workspaces")
        .select("deleted_at")
        .eq("id", workspaceB)
        .maybeSingle();
      expect(rowB?.deleted_at).toBeNull();
    });

    it("AS-021 (RLS/switcher): a soft-deleted workspace no longer appears in the member's membership-scoped switcher query", async () => {
      const { deleteWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      const owner = await seedMember(workspaceId, "owner");

      currentTestUserId = owner.userId;
      await expect(deleteWorkspace(workspaceId)).rejects.toThrow(
        "NEXT_REDIRECT:/onboarding",
      );

      // Sign in as the real user and run the exact switcher-style query
      // (workspaces filtered through F012's RLS policy) to prove the
      // soft-deleted workspace is filtered out, not just flagged.
      const userClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { data: authUser } = await adminClient.auth.admin.getUserById(
        owner.userId,
      );
      const email = authUser.user?.email;
      if (!email) throw new Error("Missing test user email");

      // The test user's password was set at creation time; re-set it here
      // via admin API so we can sign in without threading the password
      // through createThrowawayUser's return value.
      await adminClient.auth.admin.updateUserById(owner.userId, {
        password: "Test-password-1!",
      });
      const { error: signInErr } = await userClient.auth.signInWithPassword({
        email,
        password: "Test-password-1!",
      });
      if (signInErr) throw new Error(`Sign-in failed: ${signInErr.message}`);

      const { data: visibleWorkspaces, error: visErr } = await userClient
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId);

      expect(visErr).toBeNull();
      expect(visibleWorkspaces).toEqual([]);

      const { data: memberships } = await userClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", owner.userId)
        .eq("status", "active");
      // The membership row itself is untouched by this feature (only the
      // workspace row is soft-deleted), but the workspace it points to no
      // longer resolves for the switcher's join.
      expect(memberships?.map((m) => m.workspace_id)).toContain(workspaceId);
    });
  },
);
