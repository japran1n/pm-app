// Integration test for F147 (AS-262), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf and member-client
// mocking pattern established by tests/integration/search-tasks.test.ts.
//
// Exercises `searchWorkspaceTasks` (lib/queries/search.ts)'s exact
// task-key resolution end to end: a real project with a real key
// (F145-assigned), a real task with a real number, searched for by that
// key in several tolerant forms (AS-262's "case-insensitive" and "dash
// optional" requirements), plus the negative cases:
//   - a key that does not exist anywhere returns no results, not an error.
//   - a key that DOES exist, but only in another workspace, returns
//     nothing when searched for in the caller's own workspace — the
//     explicit cross-workspace-leak assertion this feature calls out.

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

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "searchWorkspaceTasks exact key match (F147, AS-262)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let otherProjectId: string;
    let memberUserId: string;
    let taskId: string;
    let taskNumber: number;
    let projectKey: string;
    let otherWorkspaceTaskId: string;
    let otherWorkspaceProjectKey: string;
    let otherWorkspaceTaskNumber: number;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f147-key-search-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create test user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F147 Key Search Workspace",
          slug: `f147-key-search-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      // A second workspace the member does NOT belong to. It gets its own
      // project (which may or may not collide on key with the first
      // workspace's project — key uniqueness is only per-workspace) and
      // its own task, used below to prove a key that exists in this
      // workspace must never be found by searching workspace A.
      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F147 Other Workspace",
          slug: `f147-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(
          `Failed to create other workspace: ${otherWsErr?.message}`,
        );
      }
      otherWorkspaceId = otherWs.id;

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

      // Explicit, hand-picked keys (rather than letting the F145 trigger
      // derive one from the project name) — the trigger only auto-derives
      // when `key` is null/'' on insert, so an explicit value here is
      // respected as-is. This makes the two projects' keys deterministically
      // DIFFERENT, which matters for the cross-workspace isolation test
      // below: project keys are only unique PER WORKSPACE (F145's
      // projects_key_unique_per_workspace), so two projects in two
      // different workspaces could otherwise coincidentally derive the
      // same key from similar auto-generated test names, which would make
      // "search workspace A for workspace B's key" accidentally match
      // workspace A's OWN same-keyed task instead of testing the isolation
      // boundary this test exists to prove.
      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F147KeySearch ${uniqueSuffix.replace(/[^a-zA-Z0-9]/g, "")}`,
          key: "FKEYA",
        })
        .select("id, key")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;
      projectKey = project.key;

      const { data: otherProject, error: otherProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: otherWorkspaceId,
          name: `F147OtherWsProj ${uniqueSuffix.replace(/[^a-zA-Z0-9]/g, "")}`,
          key: "FKEYB",
        })
        .select("id, key")
        .single();
      if (otherProjectErr || !otherProject) {
        throw new Error(
          `Failed to seed other-workspace project: ${otherProjectErr?.message}`,
        );
      }
      otherProjectId = otherProject.id;
      otherWorkspaceProjectKey = otherProject.key;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Task findable by its key",
          status: "todo",
          priority: "high",
          author_id: memberUserId,
        })
        .select("id, number")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to seed task: ${taskErr?.message}`);
      }
      taskId = task.id;
      taskNumber = task.number;
      createdTaskIds.push(taskId);

      // A task in the OTHER workspace — this workspace's key must never
      // resolve to this task when searched for from workspace A, even
      // though it is a perfectly real, existing key+number combination.
      const { data: otherTask, error: otherTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherProjectId,
          title: "Task that must never leak into workspace A's search",
          status: "todo",
          priority: "high",
          author_id: memberUserId,
        })
        .select("id, number")
        .single();
      if (otherTaskErr || !otherTask) {
        throw new Error(
          `Failed to seed other-workspace task: ${otherTaskErr?.message}`,
        );
      }
      otherWorkspaceTaskId = otherTask.id;
      otherWorkspaceTaskNumber = otherTask.number;
      createdTaskIds.push(otherWorkspaceTaskId);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword(
        {
          email: memberEmail,
          password: memberPassword,
        },
      );
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      await adminClient.from("projects").delete().eq("workspace_id", workspaceId);
      await adminClient
        .from("projects")
        .delete()
        .eq("workspace_id", otherWorkspaceId);
      for (const id of [workspaceId, otherWorkspaceId]) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("AS-262: searching the canonical KEY-NUMBER form finds the exact task, ranked first", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(
        workspaceId,
        `${projectKey}-${taskNumber}`,
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(taskId);
      expect(results[0].number).toBe(taskNumber);
      expect(results[0].projectKey).toBe(projectKey);
    });

    it("AS-262: searching is case-insensitive", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(
        workspaceId,
        `${projectKey.toLowerCase()}-${taskNumber}`,
      );

      expect(results[0]?.id).toBe(taskId);
    });

    it("AS-262: searching without a dash still finds the exact task", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(
        workspaceId,
        `${projectKey.toLowerCase()}${taskNumber}`,
      );

      expect(results[0]?.id).toBe(taskId);
    });

    it("AS-262: searching with a space instead of a dash still finds the exact task", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(
        workspaceId,
        `${projectKey.toLowerCase()} ${taskNumber}`,
      );

      expect(results[0]?.id).toBe(taskId);
    });

    it("AS-262 negative: a key-shaped query that matches no real task returns no results, not an error", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      // A syntactically key-shaped query using this project's real key but
      // a task number that was never assigned.
      const results = await searchWorkspaceTasks(
        workspaceId,
        `${projectKey}-999999`,
      );

      expect(results).toEqual([]);
    });

    it("AS-262 negative / cross-workspace isolation: a key that exists in another workspace returns nothing when searched for in this workspace", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      // otherWorkspaceProjectKey + otherWorkspaceTaskNumber is a REAL,
      // existing key+number pair — just not in `workspaceId`. Searching
      // for it here must never resolve to otherWorkspaceTaskId (or any
      // task at all), proving the exact-key path can't be used to read
      // across a workspace boundary the way the assertion requires.
      const results = await searchWorkspaceTasks(
        workspaceId,
        `${otherWorkspaceProjectKey}-${otherWorkspaceTaskNumber}`,
      );

      expect(results.find((r) => r.id === otherWorkspaceTaskId)).toBeUndefined();
      expect(results).toEqual([]);
    });
  },
);
