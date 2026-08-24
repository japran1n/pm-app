// Integration test for F222 status-category-semantics (AS-410), run
// against the real linked Supabase project — mirrors the loadDotEnv/
// real-signed-in-client/beforeAll-seed/afterAll-teardown pattern
// established by tests/integration/f219-status-management.test.ts,
// tests/integration/f220-status-delete-reassign.test.ts, and
// tests/integration/f221-board-custom-columns.test.ts.
//
// Exercises the REAL read paths this feature made category-aware:
//   - getProjectBoardTasks (lib/queries/tasks.ts, backed by the
//     get_project_board_tasks RPC): PROGRESS (child_done/completion) and
//     DEPENDENCY (open_blocker_count).
//   - getOpenBlockers (lib/actions/tasks.ts): DEPENDENCY.
//   - the get_overdue_count RPC directly: OVERDUE.
//
// The whole point of AS-410, proven in every section below with a
// matched pair: a task in a RENAMED/custom column whose CATEGORY is
// `done` counts as complete, and a task in a column merely NAMED
// something like "done-ish" whose category is NOT `done` does not —
// neither can be passed by matching on the column's name.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F222: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F222 status-category-semantics (AS-410)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;

    // Two done-category columns (so a project with real custom columns
    // is exercised, per this feature's Definition of done), plus one
    // "looks done, isn't" column, on top of the default four F218 seeds
    // for every new project.
    let doneColumnId: string; // "Shipped", category done
    let secondDoneColumnId: string; // "Complete", category done
    let doneNamedColumnId: string; // "done-ish", category in_progress

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    async function makeTask(opts: {
      status: string;
      statusId?: string | null;
      dueDate?: string | null;
      parentTaskId?: string | null;
      position?: number;
    }) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F222 task ${Math.random().toString(36).slice(2, 8)}`,
          status: opts.status,
          status_id: opts.statusId ?? undefined,
          due_date: opts.dueDate ?? undefined,
          parent_task_id: opts.parentTaskId ?? undefined,
          position: opts.position ?? 1000,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to create task: ${error?.message}`);
      }
      return data.id as string;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F222 Workspace", slug: `f222-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const email = `f222-member-${uniqueSuffix}@example.com`;
      const { data: userData, error: userErr } =
        await adminClient.auth.admin.createUser({
          email,
          password: memberPassword,
          email_confirm: true,
        });
      if (userErr || !userData.user) {
        throw new Error(`Failed to create member user: ${userErr?.message}`);
      }
      memberUserId = userData.user.id;
      memberEmail = email;
      createdUserIds.push(memberUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F222 Project ${uniqueSuffix}`,
          created_by: memberUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: cols, error: colErr } = await adminClient
        .from("project_statuses")
        .insert([
          {
            project_id: projectId,
            name: "Shipped",
            color: "#22c55e",
            category: "done",
            position: 5000,
          },
          {
            project_id: projectId,
            name: "Complete",
            color: "#22c55e",
            category: "done",
            position: 6000,
          },
          {
            project_id: projectId,
            name: "done-ish",
            color: "#f59e0b",
            category: "in_progress",
            position: 7000,
          },
        ])
        .select("id, name");
      if (colErr || !cols) {
        throw new Error(`Failed to seed custom columns: ${colErr?.message}`);
      }
      doneColumnId = cols.find((c) => c.name === "Shipped")!.id;
      secondDoneColumnId = cols.find((c) => c.name === "Complete")!.id;
      doneNamedColumnId = cols.find((c) => c.name === "done-ish")!.id;
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_statuses").delete().eq("project_id", pId);
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

    // ------------------------------------------------------------------
    // PROGRESS: get_project_board_tasks's child_done aggregate (feeds
    // TaskCard's completion %, F154).
    // ------------------------------------------------------------------
    describe("progress", () => {
      it("test_AS_410_progress_a_child_in_a_renamed_done_category_column_counts_toward_completion", async () => {
        const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
        await signInAs(memberEmail, memberPassword);

        const parentId = await makeTask({ status: "todo" });
        await makeTask({
          status: "Shipped",
          statusId: doneColumnId,
          parentTaskId: parentId,
        });
        await makeTask({
          status: "done-ish",
          statusId: doneNamedColumnId,
          parentTaskId: parentId,
        });

        const rows = await getProjectBoardTasks(projectId);
        const parent = rows.find((r) => r.id === parentId);
        expect(parent).toBeDefined();
        // Only the "Shipped" (done-category) child counts as done — the
        // "done-ish" (in_progress-category) child does not, despite its
        // name.
        expect(parent!.completion).toEqual({
          done: 1,
          total: 2,
          percent: 50,
        });
      });
    });

    // ------------------------------------------------------------------
    // OVERDUE: get_overdue_count RPC (feeds the dashboard's overdue
    // tile, F075/F124).
    // ------------------------------------------------------------------
    describe("overdue", () => {
      it("test_AS_410_overdue_a_past_due_task_in_a_renamed_done_category_column_is_excluded_from_the_count", async () => {
        await makeTask({
          status: "Shipped",
          statusId: doneColumnId,
          dueDate: "2020-01-01",
        });

        const { data, error } = await adminClient.rpc("get_overdue_count", {
          p_workspace_id: workspaceId,
          p_timezone: "UTC",
        });
        expect(error).toBeNull();
        // The overdue count must be 0: the only past-due task in this
        // workspace is in a done-category column.
        expect(Number(data)).toBe(0);
      });

      it("test_AS_410_overdue_a_past_due_task_in_a_done_named_but_non_done_category_column_still_counts", async () => {
        await makeTask({
          status: "done-ish",
          statusId: doneNamedColumnId,
          dueDate: "2020-01-01",
        });

        const { data, error } = await adminClient.rpc("get_overdue_count", {
          p_workspace_id: workspaceId,
          p_timezone: "UTC",
        });
        expect(error).toBeNull();
        expect(Number(data)).toBeGreaterThanOrEqual(1);
      });
    });

    // ------------------------------------------------------------------
    // DEPENDENCY: getOpenBlockers / get_project_board_tasks's
    // open_blocker_count (F157/F158, AS-280..AS-283).
    // ------------------------------------------------------------------
    describe("dependency", () => {
      it("test_AS_410_dependency_a_blocker_in_a_renamed_done_category_column_is_not_an_open_blocker", async () => {
        const { getOpenBlockers } = await import("@/lib/actions/tasks");
        await signInAs(memberEmail, memberPassword);

        const blockedId = await makeTask({ status: "todo" });
        const blockingId = await makeTask({
          status: "Complete",
          statusId: secondDoneColumnId,
        });

        const { error: depErr } = await adminClient
          .from("task_dependencies")
          .insert({
            blocked_task_id: blockedId,
            blocking_task_id: blockingId,
            created_by: memberUserId,
          });
        expect(depErr).toBeNull();

        const result = await getOpenBlockers(blockedId);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.find((b) => b.taskId === blockingId)).toBeUndefined();
        }
      });

      it("test_AS_410_dependency_a_blocker_named_like_done_but_not_done_category_is_still_an_open_blocker", async () => {
        const { getOpenBlockers } = await import("@/lib/actions/tasks");
        await signInAs(memberEmail, memberPassword);

        const blockedId = await makeTask({ status: "todo" });
        const blockingId = await makeTask({
          status: "done-ish",
          statusId: doneNamedColumnId,
        });

        const { error: depErr } = await adminClient
          .from("task_dependencies")
          .insert({
            blocked_task_id: blockedId,
            blocking_task_id: blockingId,
            created_by: memberUserId,
          });
        expect(depErr).toBeNull();

        const result = await getOpenBlockers(blockedId);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.find((b) => b.taskId === blockingId)).toBeDefined();
        }
      });

      it("test_AS_410_dependency_open_blocker_count_on_the_board_query_is_category_aware", async () => {
        const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
        await signInAs(memberEmail, memberPassword);

        const blockedId = await makeTask({ status: "todo" });
        await makeTask({
          status: "done-ish",
          statusId: doneNamedColumnId,
        });
        const { data: blockingRow } = await adminClient
          .from("tasks")
          .select("id")
          .eq("project_id", projectId)
          .eq("status_id", doneNamedColumnId)
          .limit(1)
          .single();

        await adminClient.from("task_dependencies").insert({
          blocked_task_id: blockedId,
          blocking_task_id: blockingRow!.id,
          created_by: memberUserId,
        });

        const rows = await getProjectBoardTasks(projectId);
        const blocked = rows.find((r) => r.id === blockedId);
        expect(blocked?.openBlockerCount).toBe(1);
      });
    });

    // ------------------------------------------------------------------
    // status_id-null fallback: exercised directly against the real DB
    // helper both TypeScript's isDoneStatus and every RPC in this
    // migration defer to (public.is_done_status), proving the SQL twin's
    // explicit fallback rule, not just the TypeScript one already
    // covered by tests/unit/status-category.test.ts.
    // ------------------------------------------------------------------
    it("test_AS_410_db_is_done_status_falls_back_to_literal_status_text_when_status_id_is_null", async () => {
      const doneResult = await adminClient.rpc("is_done_status", {
        p_status_id: null,
        p_status: "done",
      });
      expect(doneResult.error).toBeNull();
      expect(doneResult.data).toBe(true);

      const notDoneResult = await adminClient.rpc("is_done_status", {
        p_status_id: null,
        p_status: "todo",
      });
      expect(notDoneResult.error).toBeNull();
      expect(notDoneResult.data).toBe(false);
    });

    it("test_AS_410_db_is_done_status_uses_category_over_the_literal_name_when_status_id_resolves", async () => {
      // A resolvable status_id pointing at a done-CATEGORY column named
      // "done-ish"-adjacent... this project's real "Shipped" column
      // (category done, non-"done" name) proves the category wins.
      const shippedResult = await adminClient.rpc("is_done_status", {
        p_status_id: doneColumnId,
        p_status: "Shipped",
      });
      expect(shippedResult.error).toBeNull();
      expect(shippedResult.data).toBe(true);

      // And the symmetric negative: a resolvable status_id pointing at a
      // non-done-category column literally named "done-ish" must NOT
      // count, proving category wins over a done-looking name too.
      const doneishResult = await adminClient.rpc("is_done_status", {
        p_status_id: doneNamedColumnId,
        p_status: "done-ish",
      });
      expect(doneishResult.error).toBeNull();
      expect(doneishResult.data).toBe(false);
    });
  },
);
