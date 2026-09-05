// Integration test for F005b (missions/20260903-portal): a stable key
// for the page task type, run against the real linked Supabase project.
// Mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/f005-portal-pages.test.ts.
//
// Primary success test (this feature's own Definition of done): renaming
// the page task type to "Sida" leaves the Pages view returning the same
// rows — `getPortalPages` follows `system_key`, not the type's name.
// Failure test: a workspace with no keyed page type renders the empty
// state and returns zero rows, even though it has a differently-named
// type that would previously have matched by name.
// Side-effect: `create_workspace_with_owner` (amended by
// 20260912010000_task_type_system_key.sql) seeds a `system_key = 'page'`
// task type on every new workspace.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

// Same mock shape as f005-portal-pages.test.ts: getPortalPages calls
// createClient() from @/lib/supabase/server, which needs a live Next.js
// request context.
let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

describe.skipIf(!haveCreds)("task type system_key (F005b: AS-014)", () => {
  let admin: SupabaseClient;

  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdProjectIds: string[] = [];

  beforeAll(() => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    if (!admin) return;
    if (createdProjectIds.length > 0) {
      await admin.from("tasks").delete().in("project_id", createdProjectIds);
      await admin.from("project_members").delete().in("project_id", createdProjectIds);
      await admin.from("projects").delete().in("id", createdProjectIds);
    }
    for (const workspaceId of createdWorkspaceIds) {
      await admin.from("task_types").delete().eq("workspace_id", workspaceId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function makeUser(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: `f005b-${label}-${suffix}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
    createdUserIds.push(data.user.id);
    return { id: data.user.id, email: data.user.email! };
  }

  async function signIn(email: string) {
    const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`sign in ${email}: ${error.message}`);
    return session;
  }

  async function buildFixture() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const owner = await makeUser(`owner-${suffix}`);
    const clientUser = await makeUser(`client-${suffix}`);

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: `F005b system key ${suffix}`, slug: `f005b-system-key-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    createdWorkspaceIds.push(workspace.id);

    await admin.from("workspace_members").insert([
      { workspace_id: workspace.id, user_id: owner.id, role: "owner", status: "active" },
      { workspace_id: workspace.id, user_id: clientUser.id, role: "client", status: "active" },
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspace.id,
        name: "F005b project",
        visibility: "workspace",
        created_by: owner.id,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    createdProjectIds.push(project.id);

    await admin.from("project_members").insert({
      project_id: project.id,
      user_id: clientUser.id,
      project_role: "member",
      added_by: owner.id,
    });

    const clientSession = await signIn(clientUser.email);

    return { workspaceId: workspace.id, projectId: project.id, ownerId: owner.id, clientSession };
  }

  it("test_AS_014_primary_success_renaming_the_page_type_leaves_the_pages_view_returning_the_same_rows", async () => {
    const { workspaceId, projectId, ownerId, clientSession } = await buildFixture();

    const { data: pageType, error: pageTypeError } = await admin
      .from("task_types")
      .insert({ workspace_id: workspaceId, name: "Page", color: "#3670e1", system_key: "page" })
      .select("id")
      .single();
    if (pageTypeError || !pageType) throw new Error(`task type: ${pageTypeError?.message}`);

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Homepage",
        author_id: ownerId,
        task_type_id: pageType.id,
        client_visible: true,
        page_slug: "home",
        page_order: 1,
      })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`task: ${taskError?.message}`);

    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");

    const before = await getPortalPages(projectId);
    expect(before.map((p) => p.id)).toEqual([task.id]);

    // Rename the type — a purely cosmetic, team-facing change.
    const { error: renameError } = await admin
      .from("task_types")
      .update({ name: "Sida" })
      .eq("id", pageType.id);
    expect(renameError).toBeNull();

    const after = await getPortalPages(projectId);
    expect(after.map((p) => p.id)).toEqual([task.id]);
  });

  it("test_AS_014_failure_a_workspace_with_no_keyed_page_type_renders_the_empty_state_rather_than_matching_a_similarly_named_type", async () => {
    const { workspaceId, projectId, ownerId, clientSession } = await buildFixture();

    // A type NAMED "Page" but never tagged with the system_key — must
    // NOT be matched, unlike F005's original name-based lookup.
    const { data: namedType, error: namedTypeError } = await admin
      .from("task_types")
      .insert({ workspace_id: workspaceId, name: "Page", color: "#3670e1" })
      .select("id")
      .single();
    if (namedTypeError || !namedType) throw new Error(`task type: ${namedTypeError?.message}`);

    await admin.from("tasks").insert({
      project_id: projectId,
      title: "Homepage",
      author_id: ownerId,
      task_type_id: namedType.id,
      client_visible: true,
      page_slug: "home",
      page_order: 1,
    });

    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");
    const pages = await getPortalPages(projectId);

    expect(pages).toEqual([]);
  });

  it("test_F005b_side_effect_a_new_workspace_is_seeded_with_a_system_keyed_page_type", async () => {
    // Calls the RPC directly through a real, signed-in publishable-key
    // client — `create_workspace_with_owner` reads the owner id from
    // Postgres's own `auth.uid()`, so a real session is required (same
    // reasoning tests/integration/create-workspace-owner.test.ts
    // documents). No app-level mocking needed: this proves the DB-level
    // seed, independent of the `createWorkspace` Server Action wrapper.
    const owner = await makeUser(`rpc-owner-${Date.now()}`);
    const ownerSignedInClient = await signIn(owner.email);

    const uniqueName = `F005b RPC seed ${Date.now()}`;
    const uniqueSlug = `f005b-rpc-seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const { data: rpcData, error: rpcError } = await ownerSignedInClient.rpc(
      "create_workspace_with_owner",
      { p_name: uniqueName, p_slug: uniqueSlug },
    );
    expect(rpcError).toBeNull();
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    expect(row).toBeTruthy();
    createdWorkspaceIds.push(row.id);

    const { data: seededTypes, error: seededTypesError } = await admin
      .from("task_types")
      .select("name, system_key")
      .eq("workspace_id", row.id);

    // F116: create_workspace_with_owner now seeds all six system task
    // types, not only 'page' — this test's own concern (a page type is
    // seeded, keyed 'page', named 'Page') still holds, it's just no
    // longer the ONLY row seeded.
    expect(seededTypesError).toBeNull();
    expect(seededTypes).toHaveLength(6);
    const pageRow = seededTypes!.find((t) => t.system_key === "page");
    expect(pageRow?.name).toBe("Page");
  });
});
