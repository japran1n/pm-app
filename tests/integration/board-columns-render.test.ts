// Integration test for F042 (AS-067, AS-068), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/project-detail.test.ts and the signed-in-client
// pattern from tests/integration/rls-tasks.test.ts.
//
// Exercises `getProjectBoardTasks` (lib/queries/tasks.ts), the data layer
// behind the real Board view
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx),
// seeded with tasks across all 4 statuses in the target project plus a
// task in a *different* project in the same workspace, to prove:
//   AS-067/AS-068: every task for the project is returned (so the page can
//     bucket them into the 4 fixed columns To Do / In Progress / In Review
//     / Done, in that fixed order), and a task belonging to a different
//     project never leaks into the result.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to resolve to a real,
// signed-in Supabase client for an active member of the workspace, so the
// query runs under the same RLS policy (`tasks_select_active_members`) a
// real request would.

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
  "getProjectBoardTasks (F042: AS-067, AS-068)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let otherProjectId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f042-board-member-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F042 Board Workspace", slug: `f042-board-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "owner",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F042 Board Project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
      projectId = project.id;

      const { data: otherProject, error: otherProjectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F042 Other Project" })
        .select("id")
        .single();
      if (otherProjectErr || !otherProject) {
        throw new Error(`Failed to seed other project: ${otherProjectErr?.message}`);
      }
      otherProjectId = otherProject.id;

      // One task per fixed status, in the target project, with positions
      // deliberately out of insertion order to prove ordering-by-position
      // isn't accidental.
      const statuses: { status: string; position: number; title: string }[] = [
        { status: "todo", position: 2, title: "Todo task" },
        { status: "in_progress", position: 0, title: "In progress task" },
        { status: "in_review", position: 1, title: "In review task" },
        { status: "done", position: 0, title: "Done task" },
      ];

      for (const s of statuses) {
        const { data: task, error: taskErr } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: s.title,
            status: s.status,
            position: s.position,
            author_id: memberUserId,
          })
          .select("id")
          .single();
        if (taskErr || !task) {
          throw new Error(`Failed to seed ${s.status} task: ${taskErr?.message}`);
        }
        createdTaskIds.push(task.id);
      }

      // A task in a DIFFERENT project (same workspace) — proves project
      // scoping, not just workspace scoping.
      const { data: leakTask, error: leakErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherProjectId,
          title: "Should not appear on the other board",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (leakErr || !leakTask) {
        throw new Error(`Failed to seed leak task: ${leakErr?.message}`);
      }
      createdTaskIds.push(leakTask.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      for (const id of [projectId, otherProjectId]) {
        if (id) await adminClient.from("projects").delete().eq("id", id);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("AS-067/AS-068: returns exactly the tasks for this project, each with the right status, ordered by position", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const tasks = await getProjectBoardTasks(projectId);

      expect(tasks).toHaveLength(4);

      const byStatus = Object.fromEntries(tasks.map((t) => [t.status, t.title]));
      expect(byStatus.todo).toBe("Todo task");
      expect(byStatus.in_progress).toBe("In progress task");
      expect(byStatus.in_review).toBe("In review task");
      expect(byStatus.done).toBe("Done task");

      // AS-068 (isolation): the other project's task never leaks in.
      expect(tasks.some((t) => t.title === "Should not appear on the other board")).toBe(false);
    });

    it("AS-068 (isolation): a different project's tasks are fetched independently, without this project's tasks leaking either way", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const otherTasks = await getProjectBoardTasks(otherProjectId);

      expect(otherTasks).toHaveLength(1);
      expect(otherTasks[0].title).toBe("Should not appear on the other board");
    });
  },
);
