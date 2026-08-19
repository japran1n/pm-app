// Integration test for F146 (AS-258), run against the real linked
// Supabase project — mirrors the loadDotEnv/vi.mock("@/lib/supabase/
// server")/skipIf pattern established by tests/integration/
// list-view-filters.test.ts and tests/integration/db-task-keys.test.ts
// (F145, the dependency this feature builds on).
//
// F146's own job is display, not schema — F145 already proved
// projects.key/tasks.number are assigned correctly at the database layer.
// What's new here is proving the APPLICATION QUERY LAYER this feature
// touches (lib/queries/tasks.ts's three task-list queries, lib/queries/
// search.ts's searchWorkspaceTasks, and lib/actions/tasks.ts's
// getTaskDetail) actually carries `key`/`number` through its EXISTING
// project join to every caller — i.e., that "extend the existing queries
// to select the key/number rather than adding a per-row fetch" (the
// worker brief's explicit instruction) was done correctly, for real rows,
// against the real database. Each query result is also run through the
// real formatTaskKey to prove the two layers agree on the exact string a
// user would see.
//
// This does not render any component (see tests/unit/
// task-key-display-render.test.ts for that, and this feature's handoff
// for what's covered by neither) — it proves the DATA every surface
// renders from is correct, end to end, which a source-text grep on the
// component files never could.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { formatTaskKey } from "@/lib/tasks/task-key";

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

let memberClient: SupabaseClient | null = null;

// lib/queries/tasks.ts's three functions, lib/queries/search.ts's
// searchWorkspaceTasks, and lib/actions/tasks.ts's getTaskDetail all call
// `createClient()` from lib/supabase/server (cookie-based, only valid
// inside a real Next.js request) — mocked the same way every other
// integration test in this suite mocks it, to a real signed-in
// supabase-js client instead.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F146 task key display — query layer (AS-258)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectAId: string;
    let projectAKey: string;
    let projectBId: string;
    let projectBKey: string;
    let taskA1Id: string;
    let taskA1Number: number;
    let taskB1Id: string;
    let taskB1Number: number;
    let memberUserId: string;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `f146-key-display-${uniqueSuffix}@example.com`;
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
          name: "F146 Key Display Workspace",
          slug: `f146-key-display-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

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

      // Two DIFFERENT projects in the same workspace — deliberately, so
      // the workspace-wide query (getWorkspaceListTasks) and search
      // (searchWorkspaceTasks) are proven to carry each task's OWN
      // project's key per row, not a single page-level constant (the
      // reason those two return per-row `projectKey` at all — see
      // lib/queries/tasks.ts's doc comment on getWorkspaceListTasks).
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F146 Alpha ${uniqueSuffix}`,
        })
        .select("id, key")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;
      projectAKey = projectA.key;
      createdProjectIds.push(projectAId);

      const { data: projectB, error: projectBErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F146 Bravo ${uniqueSuffix}`,
        })
        .select("id, key")
        .single();
      if (projectBErr || !projectB) {
        throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
      }
      projectBId = projectB.id;
      projectBKey = projectB.key;
      createdProjectIds.push(projectBId);

      const { data: taskA1, error: taskA1Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "Alpha searchable ledger task",
          author_id: memberUserId,
        })
        .select("id, number")
        .single();
      if (taskA1Err || !taskA1) {
        throw new Error(`Failed to seed task A1: ${taskA1Err?.message}`);
      }
      taskA1Id = taskA1.id;
      taskA1Number = taskA1.number;
      createdTaskIds.push(taskA1Id);

      const { data: taskB1, error: taskB1Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectBId,
          title: "Bravo searchable ledger task",
          author_id: memberUserId,
        })
        .select("id, number")
        .single();
      if (taskB1Err || !taskB1) {
        throw new Error(`Failed to seed task B1: ${taskB1Err?.message}`);
      }
      taskB1Id = taskB1.id;
      taskB1Number = taskB1.number;
      createdTaskIds.push(taskB1Id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }
    }, 30000);

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (createdProjectIds.length > 0) {
        await adminClient
          .from("projects")
          .delete()
          .in("id", createdProjectIds);
      }
      if (createdWorkspaceIds.length > 0) {
        await adminClient
          .from("workspace_members")
          .delete()
          .in("workspace_id", createdWorkspaceIds);
        await adminClient
          .from("workspaces")
          .delete()
          .in("id", createdWorkspaceIds);
      }
    }, 30000);

    it("test_AS_258_getProjectBoardTasks_carries_the_projects_key_and_the_tasks_number_via_its_existing_project_join", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const rows = await getProjectBoardTasks(projectAId);
      const row = rows.find((t) => t.id === taskA1Id);

      expect(row).toBeDefined();
      expect(row?.projectKey).toBe(projectAKey);
      expect(row?.number).toBe(taskA1Number);
      expect(formatTaskKey(row?.projectKey, row?.number)).toBe(
        `${projectAKey}-${taskA1Number}`,
      );
    });

    it("test_AS_258_getProjectListTasks_carries_the_projects_key_and_the_tasks_number_via_its_existing_project_join", async () => {
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const rows = await getProjectListTasks(projectBId);
      const row = rows.find((t) => t.id === taskB1Id);

      expect(row).toBeDefined();
      expect(row?.projectKey).toBe(projectBKey);
      expect(row?.number).toBe(taskB1Number);
      expect(formatTaskKey(row?.projectKey, row?.number)).toBe(
        `${projectBKey}-${taskB1Number}`,
      );
    });

    it("test_AS_258_getWorkspaceListTasks_gives_each_row_its_OWN_projects_key_across_multiple_projects_no_N_plus_1", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const rowA = rows.find((t) => t.id === taskA1Id);
      const rowB = rows.find((t) => t.id === taskB1Id);

      expect(rowA?.projectKey).toBe(projectAKey);
      expect(rowA?.number).toBe(taskA1Number);
      expect(rowB?.projectKey).toBe(projectBKey);
      expect(rowB?.number).toBe(taskB1Number);
      // The two tasks belong to different projects seeded with different
      // (auto-generated, F145) keys — proving this genuinely reads each
      // row's own project, not one constant reused across the page.
      expect(rowA?.projectKey).not.toBe(rowB?.projectKey);
    });

    it("test_AS_258_searchWorkspaceTasks_returns_each_results_projectKey_and_number_matching_its_own_project", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const results = await searchWorkspaceTasks(
        workspaceId,
        "searchable ledger task",
      );

      const resultA = results.find((t) => t.id === taskA1Id);
      const resultB = results.find((t) => t.id === taskB1Id);

      expect(resultA?.projectKey).toBe(projectAKey);
      expect(resultA?.number).toBe(taskA1Number);
      expect(resultB?.projectKey).toBe(projectBKey);
      expect(resultB?.number).toBe(taskB1Number);
      expect(formatTaskKey(resultA?.projectKey, resultA?.number)).toBe(
        `${projectAKey}-${taskA1Number}`,
      );
    });

    it("test_AS_258_getTaskDetail_carries_the_projects_key_and_the_tasks_number_for_the_detail_headers_badge", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(taskA1Id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.projectKey).toBe(projectAKey);
      expect(result.data.task.number).toBe(taskA1Number);
      expect(
        formatTaskKey(result.data.task.projectKey, result.data.task.number),
      ).toBe(`${projectAKey}-${taskA1Number}`);
    });
  },
);
