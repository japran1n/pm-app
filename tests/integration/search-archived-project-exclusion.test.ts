// F144 (AS-254): "an archived project's tasks stay excluded from ... search
// results ... while archived."
//
// searchWorkspaceTasks (lib/queries/search.ts) resolves the workspace's
// `projects` with `.is("deleted_at", null)` BEFORE calling the per-project
// `search_tasks` RPC (see that file's header comment) — this test proves
// that behaviour end-to-end rather than by code review alone, per this
// feature's "an automated test per assertion where feasible" DoD answer.
// No fix was needed here (already-compliant outcome, documented per the
// clarification's Q6 default) — mirrors the loadDotEnv/skipIf/vi.mock
// pattern from tests/integration/search-tasks.test.ts.

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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "searchWorkspaceTasks excludes archived-project tasks (F144: AS-254)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let activeProjectId: string;
    let archivedProjectId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f144-search-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create test user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F144 Search Archive Workspace",
          slug: `f144-search-archive-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed membership: ${memberErr.message}`);
      }

      const uniqueToken = `zzqx${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;

      const { data: activeProject, error: activeProjectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F144 Active Project" })
        .select("id")
        .single();
      if (activeProjectErr || !activeProject) {
        throw new Error(`Failed to seed active project: ${activeProjectErr?.message}`);
      }
      activeProjectId = activeProject.id;

      const { data: archivedProject, error: archivedProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F144 Archived Project",
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (archivedProjectErr || !archivedProject) {
        throw new Error(
          `Failed to seed archived project: ${archivedProjectErr?.message}`,
        );
      }
      archivedProjectId = archivedProject.id;

      // Same unique search token on a task in the active project (must be
      // findable) and a task in the archived project (must NOT be found).
      const { data: activeTask, error: activeTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: activeProjectId,
          title: `F144 active task ${uniqueToken}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (activeTaskErr || !activeTask) {
        throw new Error(`Failed to seed active task: ${activeTaskErr?.message}`);
      }
      createdTaskIds.push(activeTask.id);

      const { data: archivedTask, error: archivedTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: archivedProjectId,
          title: `F144 archived-project task ${uniqueToken}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (archivedTaskErr || !archivedTask) {
        throw new Error(`Failed to seed archived-project task: ${archivedTaskErr?.message}`);
      }
      createdTaskIds.push(archivedTask.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }

      (globalThis as { __f144UniqueToken?: string }).__f144UniqueToken = uniqueToken;
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      for (const id of [activeProjectId, archivedProjectId]) {
        if (id) await adminClient.from("projects").delete().eq("id", id);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("AS-254: a query matching tasks in both an active and an archived project only returns the active project's task", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const uniqueToken = (globalThis as { __f144UniqueToken?: string })
        .__f144UniqueToken as string;

      const results = await searchWorkspaceTasks(workspaceId, uniqueToken);

      expect(results.length).toBe(1);
      expect(results[0].projectId).toBe(activeProjectId);
      expect(results.some((r) => r.projectId === archivedProjectId)).toBe(false);
    });
  },
);
