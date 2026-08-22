// Integration tests for F179 (AS-318, AS-319), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf/mock pattern
// established by tests/integration/recurrence-on-complete.test.ts (F177).
//
// AS-318: a rule can be edited or removed WITHOUT deleting the task —
// proven here by editing/removing via `editTask` and re-reading the task
// row afterward (still present, only `recurrence` changed).
// AS-319: removing the rule stops future occurrences — proven end-to-end:
// remove the rule via `editTask`, then complete the task via
// `moveTaskStatus` (F177), and confirm no occurrence row is created. This
// should already hold mechanically since F177's `generateNextOccurrence`
// checks `recurrence is not null` before generating (its own documented
// skip-conditions list) — this test exists to prove that mechanical
// guarantee end-to-end through the actual edit path a user takes, not
// just via a directly-seeded null.

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
    "F179: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;
let mockAdminForClient: SupabaseClient | null = null;

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
    from: (table: string) => mockAdminForClient!.from(table),
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "editTask recurrence edit/remove (F179: AS-318, AS-319)",
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
      mockAdminForClient = adminClient;

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F179 Test Workspace",
          slug: `f179-recurrence-ui-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f179-member-${uniqueSuffix}@example.com`;
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

      await adminClient
        .from("profiles")
        .update({ timezone: "UTC" })
        .eq("id", memberUserId);

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
          name: `F179 Project ${uniqueSuffix}`,
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
      await adminClient
        .from("tasks")
        .delete()
        .in("recurrence_parent_id", createdTaskIds);
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

    async function makeRecurringTask(opts: {
      dueDate: string | null;
      recurrence?: unknown;
    }): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F179 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          status: "in_progress",
          due_date: opts.dueDate,
          recurrence: opts.recurrence ?? { freq: "daily", interval: 1 },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed recurring task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-318: editing the rule changes the stored recurrence, the task itself is otherwise untouched", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeRecurringTask({
        dueDate: "2026-10-01",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;
      const result = await editTask(taskId, {
        recurrence: { freq: "weekly", interval: 2 },
      });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("id, title, status, due_date, deleted_at, recurrence")
        .eq("id", taskId)
        .single();

      expect(row).toBeTruthy();
      expect(row?.deleted_at).toBeNull();
      expect(row?.status).toBe("in_progress");
      expect(row?.due_date).toBe("2026-10-01");
      expect(row?.recurrence).toEqual({ freq: "weekly", interval: 2 });
    });

    it("AS-318: removing the rule clears recurrence to null but the task itself remains", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeRecurringTask({
        dueDate: "2026-10-05",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;
      const result = await editTask(taskId, { recurrence: null });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("id, title, status, due_date, deleted_at, recurrence")
        .eq("id", taskId)
        .single();

      expect(row).toBeTruthy();
      expect(row?.deleted_at).toBeNull();
      expect(row?.title).toBeTruthy();
      expect(row?.recurrence).toBeNull();
    });

    it("AS-319: removing the rule then completing the task creates no occurrence", async () => {
      const { editTask, moveTaskStatus } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeRecurringTask({
        dueDate: "2026-10-10",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;

      const removeResult = await editTask(taskId, { recurrence: null });
      expect(removeResult.ok).toBe(true);

      const completeResult = await moveTaskStatus(taskId, "done");
      expect(completeResult.ok).toBe(true);

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);

      expect(occurrences ?? []).toHaveLength(0);
    });

    it("AS-319 negative control: WITHOUT removing the rule, completing the task still creates one occurrence", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");
      const taskId = await makeRecurringTask({
        dueDate: "2026-10-15",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;
      const result = await moveTaskStatus(taskId, "done");
      expect(result.ok).toBe(true);

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);

      expect(occurrences ?? []).toHaveLength(1);
    });
  },
);
