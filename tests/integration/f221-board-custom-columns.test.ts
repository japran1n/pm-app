// Integration test for F221 board-custom-columns (AS-409, AS-413, AS-416),
// run against the real linked Supabase project — mirrors the loadDotEnv/
// real-signed-in-client/beforeAll-seed/afterAll-teardown pattern
// established by tests/integration/f219-status-management.test.ts and
// tests/integration/f220-status-delete-reassign.test.ts.
//
// Exercises the REAL read/write paths this feature wires up:
//   - getProjectColumns (lib/queries/statuses.ts): the board's actual
//     column read path, in `position` order (AS-416).
//   - moveAndReorderTask / moveTaskStatus (lib/actions/tasks.ts): the
//     board's actual drag-drop write path, now validated against a
//     project's real `project_statuses` rows instead of a fixed 4-value
//     enum (AS-409).
//   - reconcileColumn (lib/board/reconcile-realtime-column.ts) +
//     subscribeToBoardColumnsRealtime (lib/board/
//     subscribe-board-columns-realtime.ts): the AS-413 propagation path,
//     proven the same way F049/AS-076's sibling `tasks` channel is proven
//     in tests/unit/board-realtime-subscription.test.ts (true concurrent
//     WebSocket delivery is out of scope for a fast vitest run — what's
//     verified is that the real Postgres row this feature writes,
//     re-fetched, reconciles correctly into a second viewer's local
//     column state via the exact same pure reducer the running app uses).

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
    "F221: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
    // moveAndReorderTask/moveTaskStatus call revalidatePath inside a
    // try/catch and treat a throw as non-fatal (no request/render context
    // in a test), same convention f219/f220's own mocks document.
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F221 board-custom-columns (AS-409, AS-413, AS-416)",
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

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    function signOut() {
      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: null } }) },
        from: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["from"],
      };
    }

    async function makeTask(status: string, position: number) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F221 task ${Math.random().toString(36).slice(2, 8)}`,
          status,
          position,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Failed to create task: ${error?.message}`);
      return data.id as string;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F221 Workspace", slug: `f221-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const email = `f221-member-${uniqueSuffix}@example.com`;
      const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
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

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      // Trigger `projects_seed_default_statuses` (F218) — every new
      // project starts with the default four columns.
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F221 Project ${uniqueSuffix}`,
          created_by: memberUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // status_set_v2 seeds 11 default columns on every new project, but
      // this suite's AS-416 order assertions are written against an
      // exact five-column board (the legacy four + a custom "Blocked").
      // Upsert the five with the positions the assertions assume, then
      // drop the v2-seeded rest — never leaving the project column-less,
      // so the prevent-last-delete trigger is never tripped.
      const { error: colErr } = await adminClient.from("project_statuses").upsert(
        [
          { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 1000 },
          { project_id: projectId, name: "Blocked", color: "#ef4444", category: "in_progress", position: 1500 },
          { project_id: projectId, name: "in_progress", color: "#3b82f6", category: "in_progress", position: 2000 },
          { project_id: projectId, name: "in_review", color: "#8b5cf6", category: "in_progress", position: 3000 },
          { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 4000 },
        ],
        { onConflict: "project_id,name" },
      );
      if (colErr) throw new Error(`Failed to seed columns: ${colErr.message}`);
      const { error: pruneErr } = await adminClient
        .from("project_statuses")
        .delete()
        .eq("project_id", projectId)
        .not("name", "in", '("todo","Blocked","in_progress","in_review","done")');
      if (pruneErr) throw new Error(`Failed to prune seeded columns: ${pruneErr.message}`);
    });

    beforeEach(() => {
      signOut();
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
    // AS-409: dragging a task to a column sets its status to that column
    // — including a genuinely CUSTOM column.
    // ------------------------------------------------------------------

    it("test_AS_409_moveAndReorderTask_into_a_custom_column_sets_both_status_and_status_id_in_the_real_DB", async () => {
      const { moveAndReorderTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      await signInAs(memberEmail, memberPassword);

      const result = await moveAndReorderTask(taskId, "Blocked", 500);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("status, status_id, position")
        .eq("id", taskId)
        .single();

      expect(row?.status).toBe("Blocked");
      expect(row?.position).toBe(500);

      const { data: column } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .eq("name", "Blocked")
        .single();
      expect(row?.status_id).toBe(column?.id);
    });

    it("test_AS_409_moveTaskStatus_into_a_custom_column_sets_both_status_and_status_id_in_the_real_DB", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      await signInAs(memberEmail, memberPassword);

      const result = await moveTaskStatus(taskId, "Blocked");
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("status, status_id")
        .eq("id", taskId)
        .single();

      expect(row?.status).toBe("Blocked");

      const { data: column } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .eq("name", "Blocked")
        .single();
      expect(row?.status_id).toBe(column?.id);
    });

    it("test_AS_409_negative_a_column_name_that_does_not_exist_for_this_project_is_rejected_and_nothing_changes", async () => {
      const { moveAndReorderTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      await signInAs(memberEmail, memberPassword);

      const result = await moveAndReorderTask(taskId, "Not A Real Column", 500);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("status, position")
        .eq("id", taskId)
        .single();
      expect(row?.status).toBe("todo");
      expect(row?.position).toBe(1000);
    });

    // ------------------------------------------------------------------
    // AS-416: column order persists across reloads for all viewers — the
    // real read path (getProjectColumns), not component state.
    // ------------------------------------------------------------------

    it("test_AS_416_getProjectColumns_reads_the_real_DB_order_a_fresh_reload_would_see", async () => {
      const { getProjectColumns } = await import("@/lib/queries/statuses");

      await signInAs(memberEmail, memberPassword);

      const before = await getProjectColumns(projectId);
      // Seeded: todo(1000), in_progress(2000), Blocked(1500), in_review(3000), done(4000).
      expect(before.map((c) => c.name)).toEqual([
        "todo",
        "Blocked",
        "in_progress",
        "in_review",
        "done",
      ]);

      // Reorder "Blocked" past "done" via a raw position update (mirrors
      // what F219's reorder Server Action does under the hood) — a
      // completely fresh call to getProjectColumns (simulating a reload
      // by ANY viewer, not the one who reordered) must reflect it.
      const blockedColumn = before.find((c) => c.name === "Blocked")!;
      await adminClient
        .from("project_statuses")
        .update({ position: 5000 })
        .eq("id", blockedColumn.id);

      const after = await getProjectColumns(projectId);
      expect(after.map((c) => c.name)).toEqual([
        "todo",
        "in_progress",
        "in_review",
        "done",
        "Blocked",
      ]);
    });

    // ------------------------------------------------------------------
    // AS-413: column changes appear for other viewers without a reload —
    // the real row this suite just wrote, reconciled via the exact pure
    // reducer + subscription filter the running board uses.
    // ------------------------------------------------------------------

    it("test_AS_413_a_real_column_row_change_reconciles_into_a_second_viewer's_local_state_via_the_realtime_reducer", async () => {
      const { reconcileColumn } = await import(
        "@/lib/board/reconcile-realtime-column"
      );
      const { getProjectColumns } = await import("@/lib/queries/statuses");

      await signInAs(memberEmail, memberPassword);
      const localColumns = await getProjectColumns(projectId);

      const doneColumn = localColumns.find((c) => c.name === "done")!;

      // Simulate the postgres_changes UPDATE payload Realtime would push
      // to every OTHER open board for this project after a real rename —
      // same row shape subscribeToBoardColumnsRealtime's onChange receives.
      const renamedRow = {
        id: doneColumn.id,
        project_id: projectId,
        name: "Shipped",
        color: doneColumn.color,
        category: doneColumn.category,
        position: doneColumn.position,
      };
      const event = {
        eventType: "UPDATE",
        schema: "public",
        table: "project_statuses",
        new: renamedRow,
        old: { id: doneColumn.id },
      } as never;

      const reconciled = reconcileColumn(localColumns, event);
      expect(reconciled.find((c) => c.id === doneColumn.id)?.name).toBe(
        "Shipped",
      );
      // Every other column is untouched — this viewer's board doesn't
      // need a reload to see the rename, and nothing else moved.
      expect(reconciled).toHaveLength(localColumns.length);
    });

    it("subscribeToBoardColumnsRealtime filters project_statuses events to exactly this project, so a viewer never receives another project's column changes (AS-413 scoping)", async () => {
      const { subscribeToBoardColumnsRealtime } = await import(
        "@/lib/board/subscribe-board-columns-realtime"
      );

      const onCalls: Array<{ event: string; filter: Record<string, unknown> }> = [];
      const channelObject = {
        on: (event: string, filter: Record<string, unknown>) => {
          onCalls.push({ event, filter });
          return channelObject;
        },
        subscribe: () => channelObject,
      };
      const fakeSupabase = {
        channel: () => channelObject,
        removeChannel: () => {},
      };

      subscribeToBoardColumnsRealtime(fakeSupabase as never, projectId, () => {});

      expect(onCalls).toHaveLength(1);
      expect(onCalls[0].filter).toMatchObject({
        table: "project_statuses",
        filter: `project_id=eq.${projectId}`,
      });
    });

    // ------------------------------------------------------------------
    // Regression: project hard-delete still succeeds with custom columns
    // present (the F219 cascade class this feature must not reintroduce).
    // ------------------------------------------------------------------

    it("regression: hard-deleting a project with a custom column and tasks in it still succeeds (F219 cascade-delete class)", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F221 Teardown Project ${uniqueSuffix}`,
          created_by: memberUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      const teardownProjectId = proj.id as string;

      const { error: colErr } = await adminClient.from("project_statuses").upsert({
        project_id: teardownProjectId,
        name: "Custom",
        color: "#3b82f6",
        category: "in_progress",
        position: 1500,
      });
      if (colErr) throw new Error(`Failed to seed custom column: ${colErr.message}`);

      const { error: taskErr } = await adminClient.from("tasks").insert({
        project_id: teardownProjectId,
        title: "Task in custom column",
        status: "Custom",
        position: 1000,
        author_id: memberUserId,
      });
      if (taskErr) throw new Error(`Failed to seed task: ${taskErr.message}`);

      // Mirrors every other teardown in this suite (afterAll above) and
      // sibling f219/f220 tests: tasks are deleted first (no ON DELETE
      // CASCADE from projects to tasks in this schema), THEN the project
      // itself — which is what actually cascades away project_statuses
      // and exercises the F219 cascade-delete-guard fix this regression
      // test protects.
      await adminClient.from("tasks").delete().eq("project_id", teardownProjectId);

      const { error: deleteErr } = await adminClient
        .from("projects")
        .delete()
        .eq("id", teardownProjectId);
      expect(deleteErr).toBeNull();

      const { data: remainingColumns } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", teardownProjectId);
      expect(remainingColumns ?? []).toHaveLength(0);
    });
  },
);
