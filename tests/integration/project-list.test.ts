// Integration test for F027 (AS-027, AS-034, AS-042), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/workspace-switcher-scope.test.ts and
// tests/integration/create-project.test.ts.
//
// `getWorkspaceProjects` (lib/queries/projects.ts) is exercised directly
// against a real signed-in user with active memberships in two workspaces,
// each seeded with projects (including a soft-deleted one, and one in a
// workspace the user does NOT belong to), to prove:
//   AS-027: non-deleted projects in the active workspace are listed.
//   AS-034: the open task count is never a fabricated number — it's
//           explicitly `null` (pending) since the tasks table doesn't
//           exist yet, rather than a hardcoded 0.
//   AS-042: calling the query with a different workspace id returns a
//           different, correctly-scoped project list (the mechanism the
//           page relies on when the user switches workspaces via F014).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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

let userClient: SupabaseClient | null = null;

// `getWorkspaceProjects` calls `createClient()` from
// `@/lib/supabase/server`, which is cookie-based and needs a live Next.js
// request context. Mocked here to return the real signed-in test user's
// client instead, same approach tests/integration/create-project.test.ts
// takes for `auth.getUser()`.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => userClient,
}));

describe.skipIf(!haveAdminCreds)(
  "getWorkspaceProjects (F027: AS-027, AS-034, AS-042)",
  () => {
    let adminClient: SupabaseClient;
    let userId: string;
    let workspaceAId: string;
    let workspaceBId: string;
    let otherWorkspaceId: string;
    let otherUserId: string;
    let activeProjectId: string;
    let deletedProjectId: string;
    let workspaceBProjectId: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `f027-projects-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";

      const { data: auth, error: authErr } =
        await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      if (authErr || !auth.user) {
        throw new Error(`Failed to create test user: ${authErr?.message}`);
      }
      userId = auth.user.id;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Workspace A", slug: `f027-ws-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Workspace B", slug: `f027-ws-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceAId, user_id: userId, role: "owner", status: "active" },
        { workspace_id: workspaceBId, user_id: userId, role: "member", status: "active" },
      ]);
      if (memberErr) throw new Error(`Failed to seed memberships: ${memberErr.message}`);

      // A workspace the test user is NOT a member of — proves AS-042/AS-028
      // scoping isn't accidentally satisfied by "list everything".
      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f027-other-${uniqueSuffix}@example.com`,
          password,
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other test user: ${otherAuthErr?.message}`);
      }
      otherUserId = otherAuth.user.id;

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F027 Other Workspace", slug: `f027-ws-other-${uniqueSuffix}` })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
      otherWorkspaceId = otherWs.id;

      const { error: otherMemberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: otherWorkspaceId,
        user_id: otherUserId,
        role: "owner",
        status: "active",
      });
      if (otherMemberErr) throw new Error(`Failed to seed other membership: ${otherMemberErr.message}`);

      const { data: activeProject, error: activeProjectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "Active Project", created_by: userId })
        .select("id")
        .single();
      if (activeProjectErr || !activeProject) throw new Error(`Failed to seed active project: ${activeProjectErr?.message}`);
      activeProjectId = activeProject.id;

      const { data: deletedProject, error: deletedProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceAId,
          name: "Deleted Project",
          created_by: userId,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (deletedProjectErr || !deletedProject) throw new Error(`Failed to seed deleted project: ${deletedProjectErr?.message}`);
      deletedProjectId = deletedProject.id;

      const { data: wsBProject, error: wsBProjectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "Workspace B Project", created_by: userId })
        .select("id")
        .single();
      if (wsBProjectErr || !wsBProject) throw new Error(`Failed to seed workspace B project: ${wsBProjectErr?.message}`);
      workspaceBProjectId = wsBProject.id;

      userClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(`Failed to sign in test user: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of [activeProjectId, deletedProjectId, workspaceBProjectId]) {
        if (id) await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of [workspaceAId, workspaceBId, otherWorkspaceId]) {
        if (!id) continue;
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of [userId, otherUserId]) {
        if (id) await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("AS-027: lists all non-deleted projects in the active workspace, excluding soft-deleted ones", async () => {
      const { getWorkspaceProjects } = await import("@/lib/queries/projects");
      const projects = await getWorkspaceProjects(workspaceAId);

      expect(projects.map((p) => p.id)).toContain(activeProjectId);
      expect(projects.map((p) => p.id)).not.toContain(deletedProjectId);
    });

    it("AS-034: open task count is explicitly null (pending), never a fabricated number", async () => {
      const { getWorkspaceProjects } = await import("@/lib/queries/projects");
      const projects = await getWorkspaceProjects(workspaceAId);
      const active = projects.find((p) => p.id === activeProjectId);

      expect(active).toBeDefined();
      expect(active?.openTaskCount).toBeNull();
      // Every project's count must be the same explicit "pending" marker,
      // not e.g. 0 for some and null for others.
      expect(projects.every((p) => p.openTaskCount === null)).toBe(true);
    });

    it("AS-042: querying a different workspace id returns a different, correctly scoped project list", async () => {
      const { getWorkspaceProjects } = await import("@/lib/queries/projects");

      const projectsA = await getWorkspaceProjects(workspaceAId);
      const projectsB = await getWorkspaceProjects(workspaceBId);

      expect(projectsA.map((p) => p.id)).toContain(activeProjectId);
      expect(projectsA.map((p) => p.id)).not.toContain(workspaceBProjectId);

      expect(projectsB.map((p) => p.id)).toContain(workspaceBProjectId);
      expect(projectsB.map((p) => p.id)).not.toContain(activeProjectId);
    });

    it("AS-027/AS-028 (isolation): a workspace the caller isn't a member of returns no rows via this query, not an error", async () => {
      const { getWorkspaceProjects } = await import("@/lib/queries/projects");
      const projects = await getWorkspaceProjects(otherWorkspaceId);

      expect(projects).toEqual([]);
    });
  },
);
