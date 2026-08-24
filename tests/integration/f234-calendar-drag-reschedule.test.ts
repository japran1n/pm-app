// Integration test for F234 calendar-drag-reschedule (AS-445), run
// against the real linked Supabase project -- mirrors the loadDotEnv/
// admin-client/mocked-`@/lib/supabase/server`-auth/beforeAll-seed/
// afterAll-teardown pattern established by
// tests/integration/f225-swimlane-drag-reassign.test.ts and
// tests/integration/edit-task.test.ts.
//
// Exercises the REAL Server Action calendar-day-grid.tsx's handleDragEnd
// calls on a drop -- `editTask` (lib/actions/tasks.ts) -- against the real
// database, never a hand-built fixture and never a direct `due_date`
// write from the test itself. This is the exact same action edit-task.
// test.ts already covers for the general case; this file's job is the
// calendar-specific risk surface: date-string fidelity across the drop
// (no off-by-one), adjacent-month cells, and per-project permission
// variance on the workspace-wide calendar surface.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F234: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

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
        data: { user: currentTestUserId ? { id: currentTestUserId } : null },
      }),
    },
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "F234 calendar drag reschedule (AS-445)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let visibleProjectId: string;
    let privateProjectId: string;

    let memberUserId: string;
    let otherMemberUserId: string;

    async function makeTask(projectId: string, dueDate: string, authorId: string) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F234 task ${Math.random().toString(36).slice(2, 8)}`,
          status: "todo",
          position: 1000,
          author_id: authorId,
          due_date: dueDate,
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
        .insert({ name: "F234 Workspace", slug: `f234-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: memberAuth, error: memberErr } = await adminClient.auth.admin.createUser({
        email: `f234-member-${uniqueSuffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (memberErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { data: otherAuth, error: otherErr } = await adminClient.auth.admin.createUser({
        email: `f234-other-${uniqueSuffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (otherErr || !otherAuth.user) {
        throw new Error(`Failed to create second member user: ${otherErr?.message}`);
      }
      otherMemberUserId = otherAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      // A workspace-visible project `memberUserId` can edit.
      const { data: visibleProject, error: visibleErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F234 Visible Project", visibility: "workspace" })
        .select("id")
        .single();
      if (visibleErr || !visibleProject) {
        throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
      }
      visibleProjectId = visibleProject.id;
      createdProjectIds.push(visibleProjectId);

      // A PRIVATE project `memberUserId` is NOT a member of -- the
      // permission-varies-per-project scenario the spec calls out:
      // `memberUserId` can reschedule tasks in `visibleProjectId` but not
      // in `privateProjectId`, on this same workspace-wide calendar
      // surface.
      const { data: privateProject, error: privateErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F234 Private Project", visibility: "private" })
        .select("id")
        .single();
      if (privateErr || !privateProject) {
        throw new Error(`Failed to seed private project: ${privateErr?.message}`);
      }
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);
      await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: otherMemberUserId,
      });
    });

    afterAll(async () => {
      for (const id of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", id);
        await adminClient.from("project_members").delete().eq("project_id", id);
        await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("test_AS_445_a_drag_really_changes_the_real_tasks_due_date_row_via_the_real_editTask_action", async () => {
      const taskId = await makeTask(visibleProjectId, "2026-06-10", memberUserId);
      currentTestUserId = memberUserId;

      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { dueDate: "2026-06-15" });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("due_date")
        .eq("id", taskId)
        .single();
      expect(row?.due_date).toBe("2026-06-15");
    });

    it("test_AS_445_off_by_one_guard_the_persisted_due_date_is_exactly_the_dropped_on_cells_YYYY_MM_DD_regardless_of_ambient_timezone", async () => {
      const taskId = await makeTask(visibleProjectId, "2026-01-01", memberUserId);
      currentTestUserId = memberUserId;

      // A month-end boundary date -- the highest-risk case for a
      // `new Date(dateOnlyString)` round trip to silently roll backward a
      // day in a zone west of UTC.
      const targetCellDate = "2026-01-31";

      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { dueDate: targetCellDate });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("due_date")
        .eq("id", taskId)
        .single();
      expect(row?.due_date).toBe(targetCellDate);
    });

    it("test_AS_445_dropping_on_a_leading_trailing_adjacent_month_day_sets_the_adjacent_months_real_date", async () => {
      const taskId = await makeTask(visibleProjectId, "2026-06-03", memberUserId);
      currentTestUserId = memberUserId;

      // A cell rendered inside the June grid (a leading day) that really
      // belongs to May -- lib/calendar/month-grid.ts already emits this
      // day's own real date for `day.date`; the persisted row must match
      // it exactly, not get clamped into June.
      const leadingDayFromPreviousMonth = "2026-05-31";

      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { dueDate: leadingDayFromPreviousMonth });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("due_date")
        .eq("id", taskId)
        .single();
      expect(row?.due_date).toBe("2026-05-31");
    });

    it("test_AS_445_negative_a_user_without_permission_on_the_tasks_project_is_rejected_by_the_action_with_db_state_unchanged", async () => {
      const taskId = await makeTask(privateProjectId, "2026-06-10", otherMemberUserId);
      // memberUserId is an active workspace member but has no
      // project_members row for privateProjectId and the project is
      // 'private' -- isProjectVisibleToCaller (reused, unmodified, from
      // editTask's own F322/F323-fixed check) must reject this.
      currentTestUserId = memberUserId;

      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { dueDate: "2026-06-20" });
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("due_date")
        .eq("id", taskId)
        .single();
      // Unchanged -- the rejected drop never reached the database.
      expect(row?.due_date).toBe("2026-06-10");
    });

    it("test_AS_445_the_same_user_CAN_reschedule_a_task_in_a_project_they_do_have_access_to_proving_the_rejection_above_is_project_specific_not_account_wide", async () => {
      const taskId = await makeTask(visibleProjectId, "2026-06-10", memberUserId);
      currentTestUserId = memberUserId;

      const { editTask } = await import("@/lib/actions/tasks");
      const result = await editTask(taskId, { dueDate: "2026-06-25" });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("due_date")
        .eq("id", taskId)
        .single();
      expect(row?.due_date).toBe("2026-06-25");
    });
  },
);
