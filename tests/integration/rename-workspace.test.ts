// Integration test for F136 (AS-240: "renaming a workspace updates the
// switcher immediately"), run against the real linked Supabase project —
// mirrors the loadDotEnv/skipIf and server-client mocking pattern
// established by tests/integration/delete-workspace.test.ts and
// tests/integration/workspace-members-list.test.ts.

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
  "renameWorkspace (F136: AS-240)",
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
        email: `f136-${prefix}-${uniqueSuffix}@example.com`,
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
          name: `F136 test ${uniqueSuffix}`,
          slug: `f136-${uniqueSuffix}`,
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
      role: "owner" | "admin" | "member" | "guest",
    ) {
      const userId = await createThrowawayUser(role);
      const { error } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role,
        status: "active",
      });
      if (error) {
        throw new Error(`Failed to seed ${role} membership: ${error.message}`);
      }
      return userId;
    }

    it("AS-240: an owner can rename a workspace, and the new name is persisted for the switcher to read on its next fetch", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = await seedMember(workspaceId, "owner");

      const result = await renameWorkspace(workspaceId, "Renamed Workspace");

      expect(result).toEqual({ ok: true, data: { name: "Renamed Workspace" } });

      // The switcher (WorkspaceLayout) reads `workspaces.name` directly —
      // proving the row itself changed is what proves a subsequent
      // switcher fetch (post revalidatePath/router.refresh) would show the
      // new name immediately, without a manual reload.
      const { data: row } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .maybeSingle();
      expect(row?.name).toBe("Renamed Workspace");
    });

    it("AS-240: an admin can also rename a workspace", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = await seedMember(workspaceId, "admin");

      const result = await renameWorkspace(workspaceId, "Admin Renamed");

      expect(result).toEqual({ ok: true, data: { name: "Admin Renamed" } });
    });

    it("AS-240 (failure case): a plain member is rejected server-side even called directly", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = await seedMember(workspaceId, "member");

      const result = await renameWorkspace(workspaceId, "Should Not Apply");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/owner or admin/i);
      }

      const { data: row } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .maybeSingle();
      expect(row?.name).not.toBe("Should Not Apply");
    });

    it("AS-240 (failure case): a guest is rejected server-side even called directly", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = await seedMember(workspaceId, "guest");

      const result = await renameWorkspace(workspaceId, "Should Not Apply");

      expect(result.ok).toBe(false);
    });

    it("(failure case): an unauthenticated caller cannot rename a workspace", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = null;

      const result = await renameWorkspace(workspaceId, "Should Not Apply");

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to rename a workspace.",
      });
    });

    it("(failure case): invalid input (empty name) is rejected before touching the database", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceId = await createWorkspace();
      currentTestUserId = await seedMember(workspaceId, "owner");

      const result = await renameWorkspace(workspaceId, "   ");

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", workspaceId)
        .maybeSingle();
      expect(row?.name).not.toBe("");
    });

    it("(side effect): renaming one workspace does not affect another workspace's row", async () => {
      const { renameWorkspace } = await import("@/lib/actions/workspaces");
      const workspaceA = await createWorkspace();
      const workspaceB = await createWorkspace();
      currentTestUserId = await seedMember(workspaceA, "owner");
      await seedMember(workspaceB, "owner");

      const result = await renameWorkspace(workspaceA, "Only A Renamed");
      expect(result.ok).toBe(true);

      const { data: rowB } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", workspaceB)
        .maybeSingle();
      expect(rowB?.name).not.toBe("Only A Renamed");
    });
  },
);
