// Integration test for the sidebar's drag-and-drop project reorder
// server action, run against the real linked Supabase project — mirrors
// the loadDotEnv/skipIf pattern established by
// tests/integration/create-project.test.ts and edit-project.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a
// real throwaway Supabase Auth user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
    "missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

import { vi } from "vitest";

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

describe.skipIf(!haveAdminCreds)("reorderProject (sidebar drag-and-drop reorder)", () => {
  let adminClient: SupabaseClient;
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let memberUserId: string;
  let viewerUserId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memberEmail = `reorder-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    const viewerEmail = `reorder-viewer-${uniqueSuffix}@example.com`;
    const { data: viewerAuth, error: viewerAuthErr } =
      await adminClient.auth.admin.createUser({
        email: viewerEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (viewerAuthErr || !viewerAuth.user) {
      throw new Error(`Failed to create viewer user: ${viewerAuthErr?.message}`);
    }
    viewerUserId = viewerAuth.user.id;
    createdUserIds.push(viewerUserId);
  });

  beforeEach(() => {
    currentTestUserId = null;
  });

  // A fresh workspace per test (not one shared workspace) -- reordering is
  // scoped to ALL non-deleted siblings in a workspace, so sharing one
  // workspace across tests would make each test's expected final order
  // depend on every earlier test's leftover projects/positions. `member`/
  // `viewer` are reused across workspaces (a user can belong to more than
  // one), only the workspace itself and its `workspace_members` rows are
  // per-test.
  async function createWorkspace(): Promise<string> {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "Reorder Project Test Workspace",
        slug: `reorder-projects-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    createdWorkspaceIds.push(ws.id);

    const { error: membersInsertErr } = await adminClient
      .from("workspace_members")
      .insert([
        { workspace_id: ws.id, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: ws.id, user_id: viewerUserId, role: "viewer", status: "active" },
      ]);
    if (membersInsertErr) {
      throw new Error(`Failed to seed members: ${membersInsertErr.message}`);
    }

    return ws.id as string;
  }

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

  async function seedProject(
    workspaceId: string,
    namePrefix: string,
    sidebarPosition: number,
  ) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: inserted, error } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `${namePrefix} ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(`Failed to seed project: ${error?.message}`);
    }
    createdProjectIds.push(inserted.id);

    // sidebar_position isn't in the generated Database type yet — same
    // "update via an untyped payload" situation this migration's own
    // callers hit (see lib/actions/projects.ts's reorderProject).
    const { error: positionErr } = await adminClient
      .from("projects")
      .update({ sidebar_position: sidebarPosition } as never)
      .eq("id", inserted.id);
    if (positionErr) {
      throw new Error(`Failed to seed sidebar_position: ${positionErr.message}`);
    }

    return inserted.id as string;
  }

  async function positionsOf(projectIds: string[]): Promise<Map<string, number | null>> {
    const { data, error } = await adminClient
      .from("projects")
      .select("id, sidebar_position")
      .in("id", projectIds)
      .returns<Array<{ id: string; sidebar_position: number | null }>>();
    if (error) {
      throw new Error(`Failed to read positions: ${error.message}`);
    }
    const map = new Map<string, number | null>();
    for (const row of data ?? []) {
      map.set(row.id, row.sidebar_position ?? null);
    }
    return map;
  }

  it("moving a project to a later position shifts the projects between its old and new slot up by one", async () => {
    const { reorderProject } = await import("@/lib/actions/projects");

    const workspaceId = await createWorkspace();
    const a = await seedProject(workspaceId, "Reorder A", 0);
    const b = await seedProject(workspaceId, "Reorder B", 1);
    const c = await seedProject(workspaceId, "Reorder C", 2);
    const d = await seedProject(workspaceId, "Reorder D", 3);

    currentTestUserId = memberUserId;

    // Move A (index 0) to index 2 -- expected final order: B, C, A, D.
    const result = await reorderProject(a, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.order).toEqual([b, c, a, d]);

    const positions = await positionsOf([a, b, c, d]);
    expect(positions.get(b)).toBe(0);
    expect(positions.get(c)).toBe(1);
    expect(positions.get(a)).toBe(2);
    expect(positions.get(d)).toBe(3);
  });

  it("moving a project to an earlier position shifts the projects between its new and old slot down by one", async () => {
    const { reorderProject } = await import("@/lib/actions/projects");

    const workspaceId = await createWorkspace();
    const a = await seedProject(workspaceId, "Reorder Earlier A", 0);
    const b = await seedProject(workspaceId, "Reorder Earlier B", 1);
    const c = await seedProject(workspaceId, "Reorder Earlier C", 2);

    currentTestUserId = memberUserId;

    // Move C (index 2) to index 0 -- expected final order: C, A, B.
    const result = await reorderProject(c, 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.order).toEqual([c, a, b]);

    const positions = await positionsOf([a, b, c]);
    expect(positions.get(c)).toBe(0);
    expect(positions.get(a)).toBe(1);
    expect(positions.get(b)).toBe(2);
  });

  it("a newPosition beyond the end of the list is clamped to the last slot rather than rejected", async () => {
    const { reorderProject } = await import("@/lib/actions/projects");

    const workspaceId = await createWorkspace();
    const a = await seedProject(workspaceId, "Reorder Clamp A", 0);
    const b = await seedProject(workspaceId, "Reorder Clamp B", 1);

    currentTestUserId = memberUserId;

    const result = await reorderProject(a, 999);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.order).toEqual([b, a]);
  });

  it("a viewer cannot reorder projects; the position is left unchanged", async () => {
    const { reorderProject } = await import("@/lib/actions/projects");

    const workspaceId = await createWorkspace();
    const a = await seedProject(workspaceId, "Reorder Viewer A", 0);
    const b = await seedProject(workspaceId, "Reorder Viewer B", 1);

    currentTestUserId = viewerUserId;

    const result = await reorderProject(a, 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/permission/i);

    const positions = await positionsOf([a, b]);
    expect(positions.get(a)).toBe(0);
    expect(positions.get(b)).toBe(1);
  });

  it("a non-member of the project's workspace cannot reorder it", async () => {
    const { reorderProject } = await import("@/lib/actions/projects");

    const workspaceId = await createWorkspace();
    const a = await seedProject(workspaceId, "Reorder Nonmember A", 0);

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nonMemberEmail = `reorder-nonmember-${uniqueSuffix}@example.com`;
    const { data: nonMemberAuth, error: nonMemberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: nonMemberEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (nonMemberAuthErr || !nonMemberAuth.user) {
      throw new Error(`Failed to create non-member user: ${nonMemberAuthErr?.message}`);
    }
    createdUserIds.push(nonMemberAuth.user.id);

    currentTestUserId = nonMemberAuth.user.id;

    const result = await reorderProject(a, 0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/permission/i);
  });
});
