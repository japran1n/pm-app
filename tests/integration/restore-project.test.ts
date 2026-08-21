// Integration test for F143 (AS-252, AS-253, AS-255), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern and
// mocked `@/lib/supabase/server` established by
// tests/integration/archive-project.test.ts.

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
    "F143: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

// AS-255's search-roundtrip test exercises the real `searchWorkspaceTasks`
// (lib/queries/search.ts), which calls both `.from("projects")` and
// `.rpc("search_tasks", ...)` on the session-scoped client, not just
// `.auth.getUser()`. Rather than re-implement (and risk diverging from)
// that query's own logic, the mocked "session" client proxies `.from`/
// `.rpc` through to a real service-role client — RLS is bypassed either
// way in this test harness (same as every other integration test in this
// suite, which all use the admin client directly), so this does not
// change what's being verified: `searchWorkspaceTasks`'s own application-
// level filtering (workspace/project scoping) is still exercised exactly
// as written.
const rpcProxyClient = haveAdminCreds
  ? createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

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
    from: (...args: Parameters<SupabaseClient["from"]>) =>
      rpcProxyClient!.from(...args),
    rpc: (...args: Parameters<SupabaseClient["rpc"]>) =>
      rpcProxyClient!.rpc(...args),
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "restoreProject (F143: AS-252, AS-253, AS-255)",
  () => {
    let adminClient: SupabaseClient;
    const createdProjectIds: string[] = [];
    const createdTaskIds: string[] = [];
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
          name: "F143 Test Workspace",
          slug: `f143-projects-${uniqueSuffix}`,
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
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
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
          email: `f143-${role}-${uniqueSuffix}@example.com`,
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

    async function seedTask(
      projectId: string,
      creatorId: string,
      opts: { deleted?: boolean } = {},
    ) {
      const { data: inserted, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F143 task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: creatorId,
          deleted_at: opts.deleted ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(inserted.id);
      return inserted;
    }

    it("AS-252: a restored project reappears with its (non-independently-deleted) tasks intact", async () => {
      const { archiveProject, restoreProject } = await import(
        "@/lib/actions/projects"
      );
      const ownerId = await seedMember("owner");
      const project = await seedProject("F143 Restore Tasks", ownerId);
      const liveTask = await seedTask(project.id, ownerId);
      const preDeletedTask = await seedTask(project.id, ownerId, {
        deleted: true,
      });

      currentTestUserId = ownerId;
      const archiveResult = await archiveProject(project.id, workspaceId);
      expect(archiveResult.ok).toBe(true);

      const restoreResult = await restoreProject(project.id, workspaceId);
      expect(restoreResult.ok).toBe(true);

      const { data: projectRow } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(projectRow?.deleted_at).toBeNull();

      // The task that was live before archiving is still live (untouched,
      // per AS-032's guarantee that archiveProject never touches tasks).
      const { data: liveTaskRow } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", liveTask.id)
        .maybeSingle();
      expect(liveTaskRow?.deleted_at).toBeNull();

      // The task that was independently soft-deleted BEFORE archiving must
      // NOT be resurrected by restoreProject.
      const { data: preDeletedTaskRow } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", preDeletedTask.id)
        .maybeSingle();
      expect(preDeletedTaskRow?.deleted_at).not.toBeNull();
    });

    it("AS-253 (failure case): a plain member cannot restore a project — rejected server-side even when called directly", async () => {
      const { archiveProject, restoreProject } = await import(
        "@/lib/actions/projects"
      );
      const ownerId = await seedMember("owner");
      const memberId = await seedMember("member");
      const project = await seedProject("F143 Member Rejected", ownerId);

      currentTestUserId = ownerId;
      const archiveResult = await archiveProject(project.id, workspaceId);
      expect(archiveResult.ok).toBe(true);

      currentTestUserId = memberId;
      const restoreResult = await restoreProject(project.id, workspaceId);

      expect(restoreResult.ok).toBe(false);
      if (!restoreResult.ok) {
        expect(restoreResult.error).toMatch(/admin or owner/i);
      }

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-253 (failure case): an unauthenticated caller cannot restore a project", async () => {
      const { archiveProject, restoreProject } = await import(
        "@/lib/actions/projects"
      );
      const ownerId = await seedMember("owner");
      const project = await seedProject("F143 Unauthenticated", ownerId);

      currentTestUserId = ownerId;
      const archiveResult = await archiveProject(project.id, workspaceId);
      expect(archiveResult.ok).toBe(true);

      currentTestUserId = null;
      const restoreResult = await restoreProject(project.id, workspaceId);

      expect(restoreResult).toEqual({
        ok: false,
        error: "You must be signed in to restore a project.",
      });

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-255: a restored project's tasks reappear in search and dashboard-relevant counts (matching pre-archive state)", async () => {
      const { archiveProject, restoreProject } = await import(
        "@/lib/actions/projects"
      );
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const ownerId = await seedMember("owner");
      const project = await seedProject(
        "F143 Search Roundtrip Unique Marker",
        ownerId,
      );
      const task = await seedTask(project.id, ownerId);
      await adminClient
        .from("tasks")
        .update({ title: "F143SearchMarkerTaskXYZ" })
        .eq("id", task.id);

      currentTestUserId = ownerId;

      // Baseline: task is findable via the active-project-scoped search
      // query (mirrors lib/queries/search.ts's own project + task
      // `deleted_at IS NULL` filters) before archiving.
      async function projectAndTaskCounts() {
        const { data: activeProjects } = await adminClient
          .from("projects")
          .select("id")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null);
        const activeProjectIds = new Set((activeProjects ?? []).map((p) => p.id));
        const { data: activeTasks } = await adminClient
          .from("tasks")
          .select("id, project_id")
          .eq("project_id", project.id)
          .is("deleted_at", null);
        return {
          projectIsActive: activeProjectIds.has(project.id),
          taskCount: (activeTasks ?? []).length,
        };
      }

      const before = await projectAndTaskCounts();
      expect(before.projectIsActive).toBe(true);
      expect(before.taskCount).toBe(1);

      const archiveResult = await archiveProject(project.id, workspaceId);
      expect(archiveResult.ok).toBe(true);

      const duringArchive = await projectAndTaskCounts();
      expect(duringArchive.projectIsActive).toBe(false);
      // Task row itself is untouched (still not independently deleted),
      // but its project no longer counts as "active" — matching AS-031's
      // exclusion contract.

      const restoreResult = await restoreProject(project.id, workspaceId);
      expect(restoreResult.ok).toBe(true);

      const after = await projectAndTaskCounts();
      expect(after).toEqual(before);

      // searchWorkspaceTasks (the real production query, not a
      // re-implementation) finds the task again post-restore, mocked
      // through the same session-client shape its caller expects.
      currentTestUserId = ownerId;
      const searchResults = await searchWorkspaceTasks(
        workspaceId,
        "F143SearchMarkerTaskXYZ",
      );
      expect(searchResults.some((r) => r.id === task.id)).toBe(true);
    });

    it("(side effect) restoring one project does not affect another archived project's row", async () => {
      const { archiveProject, restoreProject } = await import(
        "@/lib/actions/projects"
      );
      const ownerId = await seedMember("owner");
      const projectA = await seedProject("F143 Side Effect A", ownerId);
      const projectB = await seedProject("F143 Side Effect B", ownerId);

      currentTestUserId = ownerId;
      await archiveProject(projectA.id, workspaceId);
      await archiveProject(projectB.id, workspaceId);

      const restoreResult = await restoreProject(projectA.id, workspaceId);
      expect(restoreResult.ok).toBe(true);

      const { data: rowB } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", projectB.id)
        .maybeSingle();
      expect(rowB?.deleted_at).not.toBeNull();
    });

    it("(no-op) restoring a project that is not archived succeeds without error", async () => {
      const { restoreProject } = await import("@/lib/actions/projects");
      const ownerId = await seedMember("owner");
      const project = await seedProject("F143 Already Active", ownerId);

      currentTestUserId = ownerId;
      const restoreResult = await restoreProject(project.id, workspaceId);

      expect(restoreResult.ok).toBe(true);

      const { data: row } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", project.id)
        .maybeSingle();
      expect(row?.deleted_at).toBeNull();
    });
  },
);
