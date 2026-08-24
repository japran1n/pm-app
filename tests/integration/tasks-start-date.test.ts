// Integration test for F236 (AS-453: a task can have a start date, which
// must not be after its due date), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/edit-task.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
    "F236: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

import { vi } from "vitest";

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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "tasks.start_date (F236: AS-453)",
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

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F236 Test Workspace",
          slug: `f236-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f236-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
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
          name: `F236 Project ${uniqueSuffix}`,
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

    async function makeTask(fields: {
      due_date?: string | null;
      start_date?: string | null;
    } = {}): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F236 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          ...fields,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-453: the DB CHECK rejects a start date after the due date on a raw admin insert (bypassing Zod)", async () => {
      const { error } = await adminClient.from("tasks").insert({
        project_id: projectId,
        title: `F236 Invalid Task ${Date.now()}`,
        author_id: memberUserId,
        due_date: "2026-01-01",
        start_date: "2026-01-05",
      });

      expect(error).not.toBeNull();
      expect(error?.message).toContain(
        "tasks_start_date_not_after_due_date",
      );
    });

    it("AS-453: the DB CHECK rejects a start date after the due date on a raw admin update (bypassing Zod)", async () => {
      const taskId = await makeTask({ due_date: "2026-01-10" });

      const { error } = await adminClient
        .from("tasks")
        .update({ start_date: "2026-01-11" })
        .eq("id", taskId);

      expect(error).not.toBeNull();
      expect(error?.message).toContain(
        "tasks_start_date_not_after_due_date",
      );
    });

    it("AS-453: a start date equal to the due date is accepted (boundary)", async () => {
      const taskId = await makeTask({ due_date: "2026-02-10" });

      const { error } = await adminClient
        .from("tasks")
        .update({ start_date: "2026-02-10" })
        .eq("id", taskId);

      expect(error).toBeNull();
    });

    it("AS-453: a start date is accepted with a null due date", async () => {
      const taskId = await makeTask({ due_date: null });

      const { error } = await adminClient
        .from("tasks")
        .update({ start_date: "2026-03-01" })
        .eq("id", taskId);

      expect(error).toBeNull();
    });

    it("AS-453: a due date is accepted with a null start date", async () => {
      const taskId = await makeTask({ start_date: null });

      const { error } = await adminClient
        .from("tasks")
        .update({ due_date: "2026-03-15" })
        .eq("id", taskId);

      expect(error).toBeNull();
    });

    it("AS-453: editTask really sets start_date on a real row", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({ due_date: "2026-04-30" });

      currentTestUserId = memberUserId;

      const result = await editTask(taskId, { startDate: "2026-04-01" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.startDate).toBe("2026-04-01");

      const { data: row } = await adminClient
        .from("tasks")
        .select("start_date")
        .eq("id", taskId)
        .single();
      expect(row?.start_date).toBe("2026-04-01");
    });

    it("AS-453: editTask really clears start_date on a real row", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask({
        due_date: "2026-05-31",
        start_date: "2026-05-01",
      });

      currentTestUserId = memberUserId;

      const result = await editTask(taskId, { startDate: null });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.startDate).toBeNull();

      const { data: row } = await adminClient
        .from("tasks")
        .select("start_date")
        .eq("id", taskId)
        .single();
      expect(row?.start_date).toBeNull();
    });

    it("AS-453: editTask rejects a start date after the due date when both are set in the same call, via Zod, without reaching the DB", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = memberUserId;

      const result = await editTask(taskId, {
        startDate: "2026-06-20",
        dueDate: "2026-06-10",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("Start date must not be after");

      const { data: row } = await adminClient
        .from("tasks")
        .select("start_date, due_date")
        .eq("id", taskId)
        .single();
      // Neither field was written — the Zod rejection happened before any
      // update reached the database.
      expect(row?.start_date).toBeNull();
      expect(row?.due_date).toBeNull();
    });

    it("AS-453: editTask maps the DB CHECK violation to a field-level message when only one of start/due is touched and it now conflicts with the row's existing other value", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      // Existing due_date is earlier than the start date we're about to
      // set — this single-field call can't be caught by the Zod
      // cross-field refine (it never sees the existing due_date), so the
      // DB CHECK is the real last line of defense here.
      const taskId = await makeTask({ due_date: "2026-07-01" });

      currentTestUserId = memberUserId;

      const result = await editTask(taskId, { startDate: "2026-07-15" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("Start date must not be after the due date.");
    });

    it("AS-453: project hard-delete still works with start_date set on its tasks", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F236 Cascade Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create cascade project: ${projErr?.message}`);
      }

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: proj.id,
          title: `F236 Cascade Task ${uniqueSuffix}`,
          author_id: memberUserId,
          due_date: "2026-08-10",
          start_date: "2026-08-01",
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create cascade task: ${taskErr?.message}`);
      }

      // `tasks.project_id` has no ON DELETE CASCADE
      // (supabase/migrations/20260818013434_create_tasks.sql) — the
      // real delete flow (and every existing integration test's own
      // teardown, e.g. tests/integration/f322-single-task-project-visibility.test.ts)
      // deletes a project's tasks first, then the project itself.
      const { error: taskDeleteErr } = await adminClient
        .from("tasks")
        .delete()
        .eq("id", task.id);
      expect(taskDeleteErr).toBeNull();

      const { error: deleteErr } = await adminClient
        .from("projects")
        .delete()
        .eq("id", proj.id);

      expect(deleteErr).toBeNull();

      const { data: remainingTask } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", task.id)
        .maybeSingle();
      expect(remainingTask).toBeNull();
    });

    it("recurrence generator writer still works: inserting a recurrence-generated row (start_date untouched, null) succeeds", async () => {
      // Mirrors lib/recurrence/generate-next-occurrence.ts's own insert
      // shape (it never sets start_date) — proves the new CHECK doesn't
      // block that writer even though it leaves start_date null while
      // due_date is set.
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F236 Recurrence-shaped Task ${Date.now()}`,
          author_id: memberUserId,
          due_date: "2026-09-01",
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      if (data) createdTaskIds.push(data.id);
    });
  },
);
