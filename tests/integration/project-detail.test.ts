// Integration test for F030 (AS-038), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/project-list.test.ts and
// tests/integration/archive-project.test.ts.
//
// `getProjectById` (lib/queries/projects.ts) is the data layer backing the
// project detail layout (app/(workspace)/w/[workspaceSlug]/projects/
// [projectId]/layout.tsx). It's exercised directly, seeded with an active
// project, an archived (soft-deleted) project, and a project in a
// different workspace, to prove:
//   AS-038: a project (active or archived) is fetchable by id, scoped to
//           its own workspace, so the detail page's Board/List tabs have
//           real data to render for — and works for archived projects too
//           (per F029/AS-032), unlike the RLS-backed list query which
//           filters deleted_at IS NULL.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("getProjectById (F030: AS-038)", () => {
  let adminClient: SupabaseClient;
  let userId: string;
  let workspaceAId: string;
  let workspaceBId: string;
  let activeProjectId: string;
  let archivedProjectId: string;
  let workspaceBProjectId: string;

  beforeAll(async () => {
    adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
      email: `f030-project-detail-${uniqueSuffix}@example.com`,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (authErr || !auth.user) {
      throw new Error(`Failed to create test user: ${authErr?.message}`);
    }
    userId = auth.user.id;

    const { data: wsA, error: wsAErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F030 Workspace A", slug: `f030-ws-a-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
    workspaceAId = wsA.id;

    const { data: wsB, error: wsBErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F030 Workspace B", slug: `f030-ws-b-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
    workspaceBId = wsB.id;

    const { error: memberErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceAId, user_id: userId, role: "owner", status: "active" },
      { workspace_id: workspaceBId, user_id: userId, role: "owner", status: "active" },
    ]);
    if (memberErr) throw new Error(`Failed to seed memberships: ${memberErr.message}`);

    const { data: activeProject, error: activeProjectErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceAId,
        name: "Active Project",
        description: "An active project",
        created_by: userId,
      })
      .select("id")
      .single();
    if (activeProjectErr || !activeProject) {
      throw new Error(`Failed to seed active project: ${activeProjectErr?.message}`);
    }
    activeProjectId = activeProject.id;

    const { data: archivedProject, error: archivedProjectErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceAId,
        name: "Archived Project",
        description: "An archived project",
        created_by: userId,
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (archivedProjectErr || !archivedProject) {
      throw new Error(`Failed to seed archived project: ${archivedProjectErr?.message}`);
    }
    archivedProjectId = archivedProject.id;

    const { data: wsBProject, error: wsBProjectErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceBId, name: "Workspace B Project", created_by: userId })
      .select("id")
      .single();
    if (wsBProjectErr || !wsBProject) {
      throw new Error(`Failed to seed workspace B project: ${wsBProjectErr?.message}`);
    }
    workspaceBProjectId = wsBProject.id;
  });

  afterAll(async () => {
    for (const id of [activeProjectId, archivedProjectId, workspaceBProjectId]) {
      if (id) await adminClient.from("projects").delete().eq("id", id);
    }
    for (const id of [workspaceAId, workspaceBId]) {
      if (!id) continue;
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    if (userId) await adminClient.auth.admin.deleteUser(userId);
  });

  it("AS-038: an active project is fetchable by id, scoped to its workspace", async () => {
    const { getProjectById } = await import("@/lib/queries/projects");
    const project = await getProjectById(workspaceAId, activeProjectId);

    expect(project).not.toBeNull();
    expect(project?.id).toBe(activeProjectId);
    expect(project?.name).toBe("Active Project");
    expect(project?.deletedAt).toBeNull();
  });

  it("AS-038: an archived project is still fetchable by id (per F029/AS-032), not hidden like the list query", async () => {
    const { getProjectById } = await import("@/lib/queries/projects");
    const project = await getProjectById(workspaceAId, archivedProjectId);

    expect(project).not.toBeNull();
    expect(project?.id).toBe(archivedProjectId);
    expect(project?.name).toBe("Archived Project");
    expect(project?.deletedAt).not.toBeNull();
  });

  it("AS-038 (isolation): a project id from a different workspace returns null, not another workspace's data", async () => {
    const { getProjectById } = await import("@/lib/queries/projects");

    // Real project, wrong workspace id supplied.
    const wrongWorkspace = await getProjectById(workspaceBId, activeProjectId);
    expect(wrongWorkspace).toBeNull();

    // Correct pairing still works, proving the null above is the
    // workspace_id filter doing its job, not a broken query.
    const correctWorkspace = await getProjectById(workspaceBId, workspaceBProjectId);
    expect(correctWorkspace).not.toBeNull();
    expect(correctWorkspace?.id).toBe(workspaceBProjectId);
  });

  it("AS-038 (failure case): a nonexistent project id returns null, not a thrown error", async () => {
    const { getProjectById } = await import("@/lib/queries/projects");
    const project = await getProjectById(
      workspaceAId,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(project).toBeNull();
  });
});
