// Integration test for F029 (AS-030, AS-031, AS-032, AS-033), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// and mocked `@/lib/supabase/server` established by
// tests/integration/edit-project.test.ts and
// tests/integration/delete-workspace.test.ts.

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

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
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
  "archiveProject (F029: AS-030, AS-031, AS-032, AS-033)",
  () => {
    let adminClient: SupabaseClient;
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F029 Test Workspace",
          slug: `f029-projects-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const projectId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function seedMember(role: "owner" | "admin" | "member") {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: authUser, error: authErr } =
        await adminClient.auth.admin.createUser({
          email: `f029-${role}-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authErr || !authUser.user) {
        throw new Error(`Failed to create ${role} user: ${authErr?.message}`);
      }
      const userId = authUser.user.id;
      createdUserIds.push(userId);

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          role,
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed ${role} membership: ${memberErr.message}`);
      }
      return userId;
    }

    async function seedProject(namePrefix: string, creatorId: string) {
      const { data: inserted, error } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `${namePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          description: "Has some data worth keeping intact",
          created_by: creatorId,
        })
        .select("id, name")
        .single();
      if (error || !inserted) {
        throw new Error(`Failed to seed project: ${error?.message}`);
      }
      createdProjectIds.push(inserted.id);
      return inserted;
    }

    it("AS-030: a workspace owner can archive a project (deleted_at is set)", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const project = await seedProject("F029 Owner Archive", ownerId);

      currentTestUserId = ownerId;
      const result = await archiveProject(project.id, workspaceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.deletedAt).toBeTruthy();

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-030: a workspace admin can archive a project", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const adminId = await seedMember("admin");
      const project = await seedProject("F029 Admin Archive", ownerId);

      currentTestUserId = adminId;
      const result = await archiveProject(project.id, workspaceId);

      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-033 (failure case): a plain member cannot archive a project — rejected server-side even when called directly", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const memberId = await seedMember("member");
      const project = await seedProject("F029 Member Rejected", ownerId);

      currentTestUserId = memberId;
      const result = await archiveProject(project.id, workspaceId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/admin or owner/i);
      }

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).toBeNull();
    });

    it("AS-031: an archived project is excluded from the default project list query", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const project = await seedProject("F029 List Exclusion", ownerId);

      currentTestUserId = ownerId;
      const result = await archiveProject(project.id, workspaceId);
      expect(result.ok).toBe(true);

      // Same query shape as lib/queries/projects.ts's getWorkspaceProjects
      // (deleted_at IS NULL filter, scoped to this workspace).
      const { data: defaultList } = await adminClient
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);

      expect(defaultList?.map((p) => p.id)).not.toContain(project.id);
    });

    it("AS-032: an archived project's row remains fully readable by direct-by-id query, with its data intact", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const project = await seedProject("F029 Direct Read Intact", ownerId);

      currentTestUserId = ownerId;
      const result = await archiveProject(project.id, workspaceId);
      expect(result.ok).toBe(true);

      // A direct-by-id lookup (no deleted_at filter) — simulating what a
      // future project detail page (F030/F031) would do to navigate
      // directly to an archived project — must still return the full row,
      // proving the data isn't hidden or destroyed, only excluded from the
      // default list query above.
      const { data: row, error } = await adminClient
        .from("projects")
        .select("id, name, description, deleted_at")
        .eq("id", project.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(row).not.toBeNull();
      expect(row?.id).toBe(project.id);
      expect(row?.name).toBe(project.name);
      expect(row?.description).toBe("Has some data worth keeping intact");
      expect(row?.deleted_at).not.toBeNull();
    });

    it("(side effect) archiving one project does not affect another project's row", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const projectA = await seedProject("F029 Side Effect A", ownerId);
      const projectB = await seedProject("F029 Side Effect B", ownerId);

      currentTestUserId = ownerId;
      const result = await archiveProject(projectA.id, workspaceId);
      expect(result.ok).toBe(true);

      const { data: rowB } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", projectB.id)
        .maybeSingle();
      expect(rowB?.deleted_at).toBeNull();
    });

    it("(failure case) an unauthenticated caller cannot archive a project", async () => {
      const { archiveProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const project = await seedProject("F029 Unauthenticated", ownerId);

      currentTestUserId = null;
      const result = await archiveProject(project.id, workspaceId);

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to archive a project.",
      });

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).toBeNull();
    });
  },
);
