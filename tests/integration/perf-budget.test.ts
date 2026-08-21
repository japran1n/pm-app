// Integration/perf test for F089 (AS-156, AS-136), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/board-columns-render.test.ts and
// tests/integration/priority-counts-rpc.test.ts.
//
// AS-156: measures the 95th-percentile server response time of
// `getProjectBoardTasks` (lib/queries/tasks.ts, F042) against a project
// seeded with 80 tasks spread across the 4 fixed board columns (v1-scale:
// "a reasonable number of tasks, e.g. 50-100 across 4 columns" per the
// feature spec) — must be under 500ms per discovery Q27.
//
// AS-136: measures the 95th-percentile server response time of the
// dashboard's three aggregate RPCs (`get_priority_counts` F071,
// `get_status_counts` F072, `get_overdue_count` F075), called the way
// lib/queries/dashboard.ts calls them, against a workspace seeded with a
// comparable v1-scale task volume — same 500ms budget (tech-decisions.md
// has no separate number for AS-136; F089's clarified spec establishes
// this feature as where that budget is defined and measured for the
// first time, matching plan.md's "Deferred re-verification (M7)" note).
//
// Each call is run N times against the live database (not mocked) and we
// report p95 (and min/max/mean) so the numbers are real end-to-end
// latency, not synthetic. Both assertions are written to FAIL the test
// (not just log a warning) if p95 exceeds the 500ms budget, per the
// feature's DoD ("asserts they're under budget").

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

const PERF_BUDGET_MS = 500;
const RUNS = 20;

/** Runs `fn` RUNS times sequentially (warm cache, like real repeated
 * requests) and returns { p95, min, max, mean } in milliseconds. */
async function timeRuns(fn: () => PromiseLike<unknown>) {
  const timings: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.ceil(0.95 * sorted.length) - 1,
  );
  const p95 = sorted[p95Index];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p95, min, max, mean, timings };
}

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "Perf budget (F089: AS-156, AS-136)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f089-perf-member-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F089 Perf Workspace", slug: `f089-perf-${uniqueSuffix}` })
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
        .insert({ workspace_id: workspaceId, name: "F089 Perf Project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
      projectId = project.id;

      // v1-scale seed: 80 tasks spread across the 4 fixed board columns,
      // with a mix of priorities and due dates so the dashboard RPCs have
      // something non-trivial to aggregate too.
      const statuses = ["todo", "in_progress", "in_review", "done"] as const;
      const priorities = ["urgent", "high", "medium", "low", "backlog"] as const;
      const TASK_COUNT = 80;
      const rows = Array.from({ length: TASK_COUNT }, (_, i) => {
        const status = statuses[i % statuses.length];
        const priority = priorities[i % priorities.length];
        // Every 5th task overdue (due_date in the past, not done) to give
        // get_overdue_count real rows to count.
        const dueDate =
          i % 5 === 0
            ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
            : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
        return {
          project_id: projectId,
          title: `Perf task ${i}`,
          status,
          priority,
          position: i,
          author_id: memberUserId,
          due_date: dueDate,
        };
      });

      const { data: inserted, error: taskErr } = await adminClient
        .from("tasks")
        .insert(rows)
        .select("id");
      if (taskErr || !inserted) {
        throw new Error(`Failed to seed perf tasks: ${taskErr?.message}`);
      }
      createdTaskIds.push(...inserted.map((t) => t.id));

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    }, 60_000);

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    }, 30_000);

    it(
      "AS-156: getProjectBoardTasks p95 is under the 500ms budget at v1 scale (80 tasks / 4 columns)",
      async () => {
        const { getProjectBoardTasks } = await import("@/lib/queries/tasks");

        const { p95, min, max, mean } = await timeRuns(() =>
          getProjectBoardTasks(projectId),
        );

        console.log(
          `[AS-156] getProjectBoardTasks over ${RUNS} runs (ms): ` +
            `p95=${p95.toFixed(1)} min=${min.toFixed(1)} max=${max.toFixed(1)} mean=${mean.toFixed(1)}`,
        );

        expect(p95).toBeLessThan(PERF_BUDGET_MS);
      },
      30_000,
    );

    it(
      "AS-136: dashboard RPCs (priority/status/overdue counts) p95 is under the 500ms budget at v1 scale",
      async () => {
        const priorityTimes = await timeRuns(() =>
          memberClient!.rpc("get_priority_counts", { p_workspace_id: workspaceId }),
        );
        const statusTimes = await timeRuns(() =>
          memberClient!.rpc("get_status_counts", { p_workspace_id: workspaceId }),
        );
        const overdueTimes = await timeRuns(() =>
          memberClient!.rpc("get_overdue_count", { p_workspace_id: workspaceId }),
        );

        console.log(
          `[AS-136] get_priority_counts over ${RUNS} runs (ms): p95=${priorityTimes.p95.toFixed(1)} ` +
            `min=${priorityTimes.min.toFixed(1)} max=${priorityTimes.max.toFixed(1)} mean=${priorityTimes.mean.toFixed(1)}`,
        );
        console.log(
          `[AS-136] get_status_counts over ${RUNS} runs (ms): p95=${statusTimes.p95.toFixed(1)} ` +
            `min=${statusTimes.min.toFixed(1)} max=${statusTimes.max.toFixed(1)} mean=${statusTimes.mean.toFixed(1)}`,
        );
        console.log(
          `[AS-136] get_overdue_count over ${RUNS} runs (ms): p95=${overdueTimes.p95.toFixed(1)} ` +
            `min=${overdueTimes.min.toFixed(1)} max=${overdueTimes.max.toFixed(1)} mean=${overdueTimes.mean.toFixed(1)}`,
        );

        expect(priorityTimes.p95).toBeLessThan(PERF_BUDGET_MS);
        expect(statusTimes.p95).toBeLessThan(PERF_BUDGET_MS);
        expect(overdueTimes.p95).toBeLessThan(PERF_BUDGET_MS);
      },
      60_000,
    );
  },
);
