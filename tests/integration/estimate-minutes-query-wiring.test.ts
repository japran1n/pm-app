// Integration test for F167's follow-up fix, run against the real linked
// Supabase project — mirrors the loadDotEnv/vi.mock("@/lib/supabase/
// server")/skipIf pattern established by tests/integration/
// task-key-display-queries.test.ts (F146), the closest precedent for
// "prove an existing column is actually carried through an existing query
// to the exact prop shape a component expects."
//
// F167 (AS-300..AS-302) shipped `TaskCard.estimateMinutes` and
// `TaskDetailSheetTask.estimateMinutes` render logic (proven correct in
// isolation by tests/unit/estimate-progress.test.ts,
// tests/unit/task-card-over-estimate-indicator-render.test.ts and
// tests/unit/time-tracking-estimate-render.test.ts) but explicitly left
// wiring `tasks.estimate_minutes` through the query layer out of scope
// (see missions/20260818-213033/handoffs/F167-handoff.md's "Out-of-scope
// work needed") to avoid colliding with F160/F164, which were concurrently
// editing lib/actions/tasks.ts at the time.
//
// This test sets `estimate_minutes` on a real task via the admin client,
// then calls each read path a live page actually uses
// (getProjectBoardTasks, getProjectListTasks, getWorkspaceListTasks — all
// lib/queries/tasks.ts, feeding TaskCard — and getTaskDetail —
// lib/actions/tasks.ts, feeding the task detail sheet) and asserts the
// returned shape carries the real value through, proving the round trip
// this follow-up fix wires end to end rather than re-testing the render
// logic itself.

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

// lib/queries/tasks.ts's three functions and lib/actions/tasks.ts's
// getTaskDetail all call `createClient()` from lib/supabase/server
// (cookie-based, only valid inside a real Next.js request) — mocked the
// same way every other integration test in this suite mocks it, to a real
// signed-in supabase-js client instead.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F167 follow-up — estimate_minutes round-trips through the query layer",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskWithEstimateId: string;
    let taskWithoutEstimateId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `f167-estimate-wiring-${uniqueSuffix}@example.com`;
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
          name: "F167 Estimate Wiring Workspace",
          slug: `f167-estimate-wiring-${uniqueSuffix}`,
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
        .insert({ workspace_id: workspaceId, name: "F167 Estimate Wiring Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: taskWithEstimate, error: taskWithEstimateErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "Task with a real estimate",
            author_id: memberUserId,
            // The exact value asserted below throughout — set directly via
            // the admin client (the real DB column F166 added), not
            // through editTask, since this test's job is proving the
            // QUERY (read) layer carries it through, not the write path.
            estimate_minutes: 90,
          })
          .select("id")
          .single();
      if (taskWithEstimateErr || !taskWithEstimate) {
        throw new Error(
          `Failed to seed task with estimate: ${taskWithEstimateErr?.message}`,
        );
      }
      taskWithEstimateId = taskWithEstimate.id;
      createdTaskIds.push(taskWithEstimateId);

      const { data: taskWithoutEstimate, error: taskWithoutEstimateErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "Task with no estimate",
            author_id: memberUserId,
          })
          .select("id")
          .single();
      if (taskWithoutEstimateErr || !taskWithoutEstimate) {
        throw new Error(
          `Failed to seed task without estimate: ${taskWithoutEstimateErr?.message}`,
        );
      }
      taskWithoutEstimateId = taskWithoutEstimate.id;
      createdTaskIds.push(taskWithoutEstimateId);

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

    it("test_AS_300_getProjectBoardTasks_carries_estimate_minutes_through_its_RPC_into_TaskCardTask", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const rows = await getProjectBoardTasks(projectId);

      const withEstimate = rows.find((t) => t.id === taskWithEstimateId);
      const withoutEstimate = rows.find((t) => t.id === taskWithoutEstimateId);

      expect(withEstimate).toBeDefined();
      expect(withEstimate?.estimateMinutes).toBe(90);

      // AS-302: no estimate set carries through as null/undefined, never a
      // fabricated 0.
      expect(withoutEstimate).toBeDefined();
      expect(withoutEstimate?.estimateMinutes == null).toBe(true);
    });

    it("test_AS_300_getProjectListTasks_carries_estimate_minutes_through_into_TaskCardTask", async () => {
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const { tasks: rows } = await getProjectListTasks(projectId);

      const withEstimate = rows.find((t) => t.id === taskWithEstimateId);
      expect(withEstimate?.estimateMinutes).toBe(90);
    });

    it("test_AS_300_getWorkspaceListTasks_carries_estimate_minutes_through_into_TaskCardTask", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const withEstimate = rows.find((t) => t.id === taskWithEstimateId);
      expect(withEstimate?.estimateMinutes).toBe(90);
    });

    it("test_AS_300_getTaskDetail_carries_estimate_minutes_through_into_TaskDetailSheetTask", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(taskWithEstimateId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.estimateMinutes).toBe(90);
    });

    it("test_AS_302_getTaskDetail_returns_null_estimate_minutes_when_unset_not_a_fabricated_zero", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(taskWithoutEstimateId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.estimateMinutes == null).toBe(true);
    });
  },
);
