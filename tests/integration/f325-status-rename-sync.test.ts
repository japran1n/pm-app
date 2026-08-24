// Integration test for F325 (M16 scrutiny blockers A + B; AS-404,
// AS-411), run against the real linked Supabase project — mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f219-status-management.test.ts,
// f220-status-delete-reassign.test.ts, and
// f221-board-custom-columns.test.ts.
//
// Exercises, through the REAL Server Action and REAL read paths:
//   - Blocker A (AS-411): renaming a column holding several tasks must
//     not strand them — every task is still visible in that column
//     through both the board's read shape (getProjectBoardTasks) and the
//     list filter's read shape (project-list task fetch keyed on
//     `tasks.status`), and `tasks.status`/`status_id` stay consistent
//     with each other afterwards.
//   - Blocker B (AS-404): renaming EACH of the four DEFAULT seeded
//     columns succeeds through the real `updateColumn` action (the seed
//     colours now live in the approved `COLUMN_COLOR_PALETTE`).
//   - The 20260828030000 migration's trigger does not obstruct a project
//     hard-delete (the ON DELETE CASCADE regression class F219 shipped a
//     guard for) — create a project, let it seed its default columns,
//     hard-delete it, and assert it (and its columns) are gone.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F325: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F325 status rename sync + seed colours (AS-404, AS-411)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;

    let ownerEmail: string;
    const ownerPassword = "Test-password-1!";
    let ownerUserId: string;

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F325 Workspace", slug: `f325-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const email = `f325-owner-${uniqueSuffix}@example.com`;
      const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
        email,
        password: ownerPassword,
        email_confirm: true,
      });
      if (userErr || !userData.user) {
        throw new Error(`Failed to create owner user: ${userErr?.message}`);
      }
      ownerUserId = userData.user.id;
      ownerEmail = email;
      createdUserIds.push(ownerUserId);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F325 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(async () => {
      await signInAs(ownerEmail, ownerPassword);
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_statuses").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    // ------------------------------------------------------------------
    // Blocker A (AS-411): rename a column holding several tasks.
    // ------------------------------------------------------------------

    it("test_AS_411_renaming_a_column_with_several_tasks_keeps_every_task_visible_in_it_afterwards", async () => {
      const { addColumn, updateColumn } = await import("@/lib/actions/statuses");
      const { getProjectColumns } = await import("@/lib/queries/statuses");

      const added = await addColumn({
        projectId,
        name: "QA",
        color: "#ef4444",
        category: "in_progress",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      const columnId = added.data.id;

      // Seed several tasks directly into the column via its (pre-rename)
      // name, the same shape the app's existing write paths produce.
      const taskTitles = ["QA task 1", "QA task 2", "QA task 3", "QA task 4"];
      const { data: insertedTasks, error: insertErr } = await adminClient
        .from("tasks")
        .insert(
          taskTitles.map((title, i) => ({
            project_id: projectId,
            title,
            status: "QA",
            status_id: columnId,
            priority: "medium",
            author_id: ownerUserId,
            number: 1000 + i,
          })),
        )
        .select("id");
      if (insertErr || !insertedTasks) {
        throw new Error(`Failed to seed tasks: ${insertErr?.message}`);
      }
      expect(insertedTasks.length).toBe(taskTitles.length);

      const renamed = await updateColumn({
        columnId,
        name: "Review",
        color: "#ef4444",
        category: "in_progress",
      });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.data.name).toBe("Review");

      // Board read path: tasks are grouped by `task.status === column.name`
      // (components/board/board.tsx). Re-read the columns and confirm the
      // renamed column now matches every seeded task's `status` text.
      const columns = await getProjectColumns(projectId);
      const reviewColumn = columns.find((c) => c.id === columnId);
      expect(reviewColumn?.name).toBe("Review");

      const { data: taskRows, error: taskReadErr } = await adminClient
        .from("tasks")
        .select("id, status, status_id")
        .in(
          "id",
          insertedTasks.map((t) => t.id),
        );
      if (taskReadErr) throw new Error(taskReadErr.message);

      expect(taskRows?.length).toBe(taskTitles.length);
      for (const row of taskRows ?? []) {
        // The board's grouping predicate would now match every task —
        // this is the exact assertion that failed before the fix.
        expect(row.status).toBe("Review");
        expect(row.status_id).toBe(columnId);
      }

      // List filter read path (F223): filters on `tasks.status` text
      // equal to the column's current name.
      const { data: filteredRows, error: filterErr } = await adminClient
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("status", "Review");
      if (filterErr) throw new Error(filterErr.message);
      const filteredIds = new Set((filteredRows ?? []).map((r) => r.id));
      for (const t of insertedTasks) {
        expect(filteredIds.has(t.id)).toBe(true);
      }
    });

    // ------------------------------------------------------------------
    // Blocker B (AS-404): rename each default seeded column.
    // ------------------------------------------------------------------

    it("test_AS_404_each_default_seeded_column_can_be_renamed_through_the_real_action", async () => {
      const { updateColumn } = await import("@/lib/actions/statuses");
      const { getProjectColumns } = await import("@/lib/queries/statuses");

      // A fresh project so its four columns are exactly the seed defaults
      // this migration re-coloured, untouched by any other test.
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F325 Default Columns Project",
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      const defaultColumns = await getProjectColumns(proj.id);
      expect(defaultColumns.length).toBe(4);
      const byName = new Map(defaultColumns.map((c) => [c.name, c]));
      expect(byName.get("todo")?.color).toBe("#64748b");
      expect(byName.get("in_review")?.color).toBe("#d97706");
      expect(byName.get("done")?.color).toBe("#16a34a");

      const renameMap: Record<string, string> = {
        todo: "Backlog",
        in_progress: "Doing",
        in_review: "Needs review",
        done: "Shipped",
      };

      for (const column of defaultColumns) {
        const newName = renameMap[column.name];
        const result = await updateColumn({
          columnId: column.id,
          name: newName,
          color: column.color,
          category: column.category,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.data.name).toBe(newName);
      }

      const renamedColumns = await getProjectColumns(proj.id);
      const renamedNames = renamedColumns.map((c) => c.name).sort();
      expect(renamedNames).toEqual(
        ["Backlog", "Doing", "Needs review", "Shipped"].sort(),
      );
    });

    // ------------------------------------------------------------------
    // Cascade safety: the new rename-sync trigger must not obstruct a
    // project hard-delete (F219's ON DELETE CASCADE regression class).
    // ------------------------------------------------------------------

    it("test_project_hard_delete_still_works_after_seeding_default_columns", async () => {
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F325 Cascade Delete Project",
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      const cascadeProjectId = proj.id;

      const { data: seededColumns } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", cascadeProjectId);
      expect(seededColumns?.length).toBe(4);

      const { error: deleteErr } = await adminClient
        .from("projects")
        .delete()
        .eq("id", cascadeProjectId);
      expect(deleteErr).toBeNull();

      const { data: remainingProject } = await adminClient
        .from("projects")
        .select("id")
        .eq("id", cascadeProjectId)
        .maybeSingle();
      expect(remainingProject).toBeNull();

      const { data: remainingColumns } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", cascadeProjectId);
      expect(remainingColumns ?? []).toEqual([]);
    });
  },
);
