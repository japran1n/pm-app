// Integration test for F179's follow-up fix, run against the real linked
// Supabase project — mirrors the exact loadDotEnv/vi.mock("@/lib/supabase/
// server")/skipIf pattern established by
// tests/integration/estimate-minutes-query-wiring.test.ts (F167's own
// follow-up fix), the direct precedent for this same class of gap.
//
// F179 (AS-317) shipped `TaskCard.recurrence` render logic (proven correct
// in isolation by tests/unit/task-card-recurrence-indicator-render.test.ts)
// but explicitly left wiring `tasks.recurrence` through the board/list/
// workspace query layer out of scope (see
// missions/20260818-213033/handoffs/F179-handoff.md's "Out-of-scope work
// needed") — `getTaskDetail` already selected `recurrence` at the time
// (F179 itself needed it for the detail sheet's picker), so only
// `getProjectBoardTasks`, `getProjectListTasks`, and `getWorkspaceListTasks`
// were missing it.
//
// This test sets `recurrence` on a real task via the admin client, then
// calls each read path a live page actually uses (getProjectBoardTasks,
// getProjectListTasks, getWorkspaceListTasks — all lib/queries/tasks.ts,
// feeding TaskCard — and getTaskDetail — lib/actions/tasks.ts, feeding the
// task detail sheet) and asserts the returned shape carries the real rule
// through, then renders a real TaskCard with the board query's actual
// output to prove the indicator shows up end to end, not just in
// isolation against a hand-built prop.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
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

// lib/queries/tasks.ts's three functions and lib/actions/tasks.ts's
// getTaskDetail all call `createClient()` from lib/supabase/server
// (cookie-based, only valid inside a real Next.js request) — mocked the
// same way every other integration test in this suite mocks it, to a real
// signed-in supabase-js client instead.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F179 follow-up — recurrence round-trips through the query layer",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskWithRecurrenceId: string;
    let taskWithoutRecurrenceId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `f179-recurrence-wiring-${uniqueSuffix}@example.com`;
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
          name: "F179 Recurrence Wiring Workspace",
          slug: `f179-recurrence-wiring-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F179 Recurrence Wiring Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: taskWithRecurrence, error: taskWithRecurrenceErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "Task with a real recurrence rule",
            author_id: memberUserId,
            // The exact rule asserted below throughout — set directly via
            // the admin client (the real DB column F175 added), not
            // through editTask, since this test's job is proving the
            // QUERY (read) layer carries it through, not the write path.
            recurrence: { freq: "weekly", interval: 2 },
          })
          .select("id")
          .single();
      if (taskWithRecurrenceErr || !taskWithRecurrence) {
        throw new Error(
          `Failed to seed task with recurrence: ${taskWithRecurrenceErr?.message}`,
        );
      }
      taskWithRecurrenceId = taskWithRecurrence.id;
      createdTaskIds.push(taskWithRecurrenceId);

      const { data: taskWithoutRecurrence, error: taskWithoutRecurrenceErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "Task with no recurrence",
            author_id: memberUserId,
          })
          .select("id")
          .single();
      if (taskWithoutRecurrenceErr || !taskWithoutRecurrence) {
        throw new Error(
          `Failed to seed task without recurrence: ${taskWithoutRecurrenceErr?.message}`,
        );
      }
      taskWithoutRecurrenceId = taskWithoutRecurrence.id;
      createdTaskIds.push(taskWithoutRecurrenceId);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    }, 30000);

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    }, 30000);

    it("test_AS_317_getProjectBoardTasks_carries_recurrence_through_its_RPC_into_TaskCardTask", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const rows = await getProjectBoardTasks(projectId);

      const withRecurrence = rows.find((t) => t.id === taskWithRecurrenceId);
      const withoutRecurrence = rows.find(
        (t) => t.id === taskWithoutRecurrenceId,
      );

      expect(withRecurrence).toBeDefined();
      expect(withRecurrence?.recurrence).toEqual({
        freq: "weekly",
        interval: 2,
      });

      // No rule set carries through as null/undefined, never a fabricated
      // rule.
      expect(withoutRecurrence).toBeDefined();
      expect(withoutRecurrence?.recurrence == null).toBe(true);
    });

    it("test_AS_317_getProjectListTasks_carries_recurrence_through_into_TaskCardTask", async () => {
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const rows = await getProjectListTasks(projectId);

      const withRecurrence = rows.find((t) => t.id === taskWithRecurrenceId);
      expect(withRecurrence?.recurrence).toEqual({
        freq: "weekly",
        interval: 2,
      });
    });

    it("test_AS_317_getWorkspaceListTasks_carries_recurrence_through_into_TaskCardTask", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const withRecurrence = rows.find((t) => t.id === taskWithRecurrenceId);
      expect(withRecurrence?.recurrence).toEqual({
        freq: "weekly",
        interval: 2,
      });
    });

    it("test_AS_317_getTaskDetail_carries_recurrence_through_into_TaskDetailSheetTask", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(taskWithRecurrenceId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.recurrence).toEqual({
        freq: "weekly",
        interval: 2,
      });
    });

    it("test_AS_317_the_real_board_query_output_renders_a_live_recurrence_indicator_on_the_card", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const { TaskCard } = await import("@/components/task/task-card");
      const rows = await getProjectBoardTasks(projectId);

      const withRecurrence = rows.find((t) => t.id === taskWithRecurrenceId);
      const withoutRecurrence = rows.find(
        (t) => t.id === taskWithoutRecurrenceId,
      );
      expect(withRecurrence).toBeDefined();
      expect(withoutRecurrence).toBeDefined();

      // AS-317: a real recurring task's card — fed entirely from the real
      // query path this fix wires, not a hand-built prop — renders the
      // icon+text repeat indicator.
      const htmlWithRecurrence = renderToStaticMarkup(
        createElement(TaskCard, { task: withRecurrence!, timezone: "UTC" }),
      );
      expect(htmlWithRecurrence).toContain(
        'data-testid="recurrence-badge"',
      );
      expect(htmlWithRecurrence).toContain("Every 2 weeks");

      // A real non-recurring task's card, from the same real query call,
      // renders no indicator at all.
      const htmlWithoutRecurrence = renderToStaticMarkup(
        createElement(TaskCard, {
          task: withoutRecurrence!,
          timezone: "UTC",
        }),
      );
      expect(htmlWithoutRecurrence).not.toContain(
        'data-testid="recurrence-badge"',
      );
    });
  },
);
