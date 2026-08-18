// Integration test for F048 (AS-075), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/reorder-task.test.ts.
//
// Proves that after a drag-and-drop reorder (F046's reorderTask), a fresh
// re-query via getProjectBoardTasks (F042) — simulating a page reload —
// returns the cards in exactly the order they were left in. This is the
// direct evidence behind AS-075: "After a drag-and-drop reorder, reloading
// the page shows the cards in the exact order they were left in."
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test. The mock backs both
// reorderTask (F046) and getProjectBoardTasks (F042) — the latter uses the
// same request-scoped client to simulate the RLS-scoped read a real page
// reload would perform.

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

let currentTestUserId: string | null = null;

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
    from: (table: string) => {
      // Real request-scoped Supabase client used by getProjectBoardTasks —
      // routed through the admin client under the hood so the mock still
      // hits real Postgres, while auth.getUser() above stays mocked (there
      // is no real browser session in a Vitest/node environment). RLS
      // scoping is exercised separately by F042's own test suite; this
      // suite's job is exact ordering after reorder, not RLS.
      return adminClientRef.from(table);
    },
  }),
}));

let adminClientRef: SupabaseClient;

describe.skipIf(!haveAdminCreds)(
  "board reload persistence (F048: AS-075)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      adminClientRef = adminClient;

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F048 Test Workspace",
          slug: `f048-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f048-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create member user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F048 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function makeTask(
      status: string,
      position: number,
      title: string,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          author_id: memberUserId,
          status,
          position,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-075: reordering cards then re-querying via getProjectBoardTasks (simulated reload) returns the exact left-off order", async () => {
      const { reorderTask } = await import("@/lib/actions/tasks");
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");

      // Seed three tasks in the same column, in an arbitrary initial order:
      // A (100), B (200), C (300) -> A, B, C.
      const taskA = await makeTask("todo", 100, "F048 Card A");
      const taskB = await makeTask("todo", 200, "F048 Card B");
      const taskC = await makeTask("todo", 300, "F048 Card C");

      currentTestUserId = memberUserId;

      // Simulate a drag-and-drop that leaves the column in the order
      // B, C, A: drag A to the bottom (after C).
      const moveResult = await reorderTask(taskA, 400);
      expect(moveResult.ok).toBe(true);

      // "Reload the page": fresh Server Component query, independent of
      // the reorder call above, exactly as a real navigation/refresh would
      // re-invoke getProjectBoardTasks from scratch.
      const boardTasks = await getProjectBoardTasks(projectId);

      const todoOrder = boardTasks
        .filter((t) => t.status === "todo")
        .map((t) => t.id);

      expect(todoOrder).toEqual([taskB, taskC, taskA]);

      // Second reorder, different resulting order, to prove this isn't a
      // coincidence of the first move: drag C to the very top (ahead of
      // B), leaving C, B, A.
      const secondMove = await reorderTask(taskC, 50);
      expect(secondMove.ok).toBe(true);

      const boardTasksAfterSecondMove = await getProjectBoardTasks(projectId);
      const todoOrderAfterSecondMove = boardTasksAfterSecondMove
        .filter((t) => t.status === "todo")
        .map((t) => t.id);

      expect(todoOrderAfterSecondMove).toEqual([taskC, taskB, taskA]);
    });
  },
);
