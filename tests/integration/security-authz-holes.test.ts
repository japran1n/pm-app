// Security audit fix: five authorization holes found in a database audit
// (2026-09-04). Each `it` below reproduces the hole against the REAL
// PostgREST surface using the caller's own JWT (never the service-role
// admin client, which app code uses internally and was never the
// vulnerable path) — proving these are reachable by any signed-in user
// (or, for hole 5, by `anon`) directly via `supabase.rpc()`/PostgREST,
// bypassing every app-layer check in lib/actions/workspaces.ts entirely.
//
// Hole 1: transfer_workspace_ownership — no caller authorization at all.
// Hole 2: remove_workspace_member — no caller authorization at all.
// Hole 3: change_workspace_slug_atomic — no caller authorization at all.
// Hole 4: guest writes are workspace-wide, not project-scoped like guest
//   reads (is_project_workspace_writer dropped its guest branch).
// Hole 5: generate_unique_project_key — anon-reachable existence oracle.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { poolUserId, getPoolSession } from "../helpers/auth";

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "security-authz-holes: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("security audit: authorization holes", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(() => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    for (const workspaceId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspace_slug_history").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // F126: pooled identities (see tests/helpers/auth.ts) — reused across
  // every `it` below instead of a fresh user per hole; each `it` seeds its
  // own workspace, so reusing the same slot across `it`s is safe. NOT
  // pushed onto createdUserIds, so this file's afterAll never deletes
  // them.
  const OWNER = 0;
  const VIEWER = 1;
  const GUEST = 2;

  async function poolUser(slot: number) {
    return { userId: await poolUserId(slot) };
  }

  async function signIn(slot: number) {
    return getPoolSession(slot);
  }

  async function createWorkspace() {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: workspace, error } = await adminClient
      .from("workspaces")
      .insert({ name: `sec-audit ${uniqueSuffix}`, slug: `sec-audit-${uniqueSuffix}` })
      .select("id, slug")
      .single();
    if (error || !workspace) throw new Error(`Failed to create workspace: ${error?.message}`);
    createdWorkspaceIds.push(workspace.id);
    return workspace as { id: string; slug: string };
  }

  async function seedMember(
    workspaceId: string,
    userId: string,
    role: "owner" | "admin" | "member" | "viewer" | "guest" | "client",
  ) {
    const { data, error } = await adminClient
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: userId, role, status: "active" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed ${role} membership: ${error?.message}`);
    return data.id as string;
  }

  // ---------------------------------------------------------------------
  // Hole 1: transfer_workspace_ownership
  // ---------------------------------------------------------------------
  it("hole 1: a viewer CANNOT call transfer_workspace_ownership directly via RPC to take over their own workspace", async () => {
    const workspace = await createWorkspace();
    const owner = await poolUser(OWNER);
    const viewer = await poolUser(VIEWER);
    const ownerMembershipId = await seedMember(workspace.id, owner.userId, "owner");
    await seedMember(workspace.id, viewer.userId, "viewer");

    const viewerClient = await signIn(VIEWER);

    const { error } = await viewerClient.rpc("transfer_workspace_ownership", {
      p_workspace_id: workspace.id,
      p_new_owner_user_id: viewer.userId,
    });

    // Before the fix: this succeeds (error is null) and the viewer becomes
    // owner. After the fix: PostgREST/Postgres rejects the call outright
    // (permission denied, since the `authenticated` grant is revoked) and
    // the roles are unchanged.
    expect(error).not.toBeNull();

    const { data: ownerRow } = await adminClient
      .from("workspace_members")
      .select("role")
      .eq("id", ownerMembershipId)
      .maybeSingle();
    expect(ownerRow?.role).toBe("owner");
  });

  // ---------------------------------------------------------------------
  // Hole 2: remove_workspace_member
  // ---------------------------------------------------------------------
  it("hole 2: a viewer CANNOT call remove_workspace_member directly via RPC to evict another member", async () => {
    const workspace = await createWorkspace();
    const owner = await poolUser(OWNER);
    const viewer = await poolUser(VIEWER);
    await seedMember(workspace.id, owner.userId, "owner");
    const viewerMembershipId = await seedMember(workspace.id, viewer.userId, "viewer");

    const viewerClient = await signIn(VIEWER);

    const { error } = await viewerClient.rpc("remove_workspace_member", {
      p_membership_id: viewerMembershipId,
      p_workspace_id: workspace.id,
    });

    expect(error).not.toBeNull();

    const { data: viewerRow } = await adminClient
      .from("workspace_members")
      .select("status")
      .eq("id", viewerMembershipId)
      .maybeSingle();
    expect(viewerRow?.status).toBe("active");
  });

  // ---------------------------------------------------------------------
  // Hole 3: change_workspace_slug_atomic
  // ---------------------------------------------------------------------
  it("hole 3: a viewer CANNOT call change_workspace_slug_atomic directly via RPC to rename the workspace", async () => {
    const workspace = await createWorkspace();
    const viewer = await poolUser(VIEWER);
    await seedMember(workspace.id, viewer.userId, "viewer");

    const viewerClient = await signIn(VIEWER);

    const { error } = await viewerClient.rpc("change_workspace_slug_atomic", {
      p_workspace_id: workspace.id,
      p_old_slug: workspace.slug,
      p_new_slug: `${workspace.slug}-hijacked`,
    });

    expect(error).not.toBeNull();

    const { data: wsRow } = await adminClient
      .from("workspaces")
      .select("slug")
      .eq("id", workspace.id)
      .maybeSingle();
    expect(wsRow?.slug).toBe(workspace.slug);
  });

  // ---------------------------------------------------------------------
  // Hole 4: guest writes are workspace-wide, not project-scoped
  // ---------------------------------------------------------------------
  it("hole 4: a guest CANNOT write (insert a comment on) a task in a project they were never added to", async () => {
    const workspace = await createWorkspace();
    const owner = await poolUser(OWNER);
    const guest = await poolUser(GUEST);
    await seedMember(workspace.id, owner.userId, "owner");
    await seedMember(workspace.id, guest.userId, "guest");

    // A workspace-visible project the guest has NO project_members row for.
    const { data: project, error: projErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspace.id, name: `h4 project`, visibility: "workspace" })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project seed failed: ${projErr?.message}`);

    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({ project_id: project.id, title: "h4 task", author_id: owner.userId })
      .select("id")
      .single();
    if (taskErr || !task) throw new Error(`task seed failed: ${taskErr?.message}`);

    const guestClient = await signIn(GUEST);

    const { error } = await guestClient.from("comments").insert({
      task_id: task.id,
      user_id: guest.userId,
      text: "hole 4 unscoped guest write",
    });

    // Before the fix: this succeeds — RLS's is_project_workspace_writer
    // treats any active non-viewer role (including guest, workspace-wide)
    // as a writer. After the fix: rejected, because the guest has no
    // project_members row for this project.
    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Hole 5: generate_unique_project_key anon-reachable existence oracle
  // ---------------------------------------------------------------------
  it("hole 5: an unauthenticated (anon) caller CANNOT call generate_unique_project_key via RPC", async () => {
    const workspace = await createWorkspace();
    const anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);

    const { error } = await anonClient.rpc("generate_unique_project_key", {
      p_workspace_id: workspace.id,
      p_name: "Marketing",
    });

    expect(error).not.toBeNull();
  });
});
