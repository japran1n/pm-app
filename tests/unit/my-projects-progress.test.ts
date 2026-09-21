// F004 (AS-050, AS-051, AS-052): unit coverage for
// `getMyProjectsProgress` (lib/queries/projects.ts) — the workspace home
// "My projects" card's per-project doneCount/totalCount/overdueCount data.
//
// Mirrors tests/unit/project-health-inputs-done-count.test.ts's
// filter-honouring mock convention (via the shared query-filter-mock
// helper) rather than a mock that ignores its own filter arguments.

import { describe, expect, it, vi } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

let memberRows: Row[];
let taskRows: Row[];
let statusRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "project_members") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                if (col === "user_id") {
                  filters.push(eqFilter(col, val));
                } else if (col === "projects.workspace_id") {
                  filters.push((row: Row) => (row.projects as Row).workspace_id === val);
                }
                return builder;
              }),
              is: vi.fn(async (col: string, val: unknown) => {
                if (col === "projects.deleted_at") {
                  filters.push((row: Row) => (row.projects as Row).deleted_at === val);
                }
                return { data: applyFilters(memberRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              is: vi.fn(async (col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return { data: applyFilters(taskRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_statuses") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn(async (col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return { data: applyFilters(statusRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getMyProjectsProgress } from "@/lib/queries/projects";

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

describe("getMyProjectsProgress", () => {
  it("AS_050_returns_done_and_total_counts_for_progress_bar", async () => {
    memberRows = [
      {
        project_id: "p1",
        user_id: "u1",
        projects: { id: "p1", name: "Alpha", key: "ALP", workspace_id: "w1", deleted_at: null },
      },
    ];
    statusRows = [
      { id: "s-done", project_id: "p1", name: "Done", category: "done", client_bucket: null },
      { id: "s-todo", project_id: "p1", name: "Todo", category: "not_started", client_bucket: null },
    ];
    taskRows = [
      { id: "t1", project_id: "p1", status: "Done", status_id: "s-done", due_date: null, deleted_at: null },
      { id: "t2", project_id: "p1", status: "Done", status_id: "s-done", due_date: null, deleted_at: null },
      { id: "t3", project_id: "p1", status: "Todo", status_id: "s-todo", due_date: null, deleted_at: null },
    ];

    const result = await getMyProjectsProgress("w1", "u1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ projectId: "p1", doneCount: 2, totalCount: 3 });
  });

  it("AS_051_counts_only_non_done_tasks_past_due_as_overdue", async () => {
    memberRows = [
      {
        project_id: "p1",
        user_id: "u1",
        projects: { id: "p1", name: "Alpha", key: "ALP", workspace_id: "w1", deleted_at: null },
      },
    ];
    statusRows = [
      { id: "s-done", project_id: "p1", name: "Done", category: "done", client_bucket: null },
      { id: "s-todo", project_id: "p1", name: "Todo", category: "not_started", client_bucket: null },
    ];
    taskRows = [
      // Overdue: not done, due in the past.
      { id: "t1", project_id: "p1", status: "Todo", status_id: "s-todo", due_date: yesterday, deleted_at: null },
      // Done task with a past due date is NOT overdue.
      { id: "t2", project_id: "p1", status: "Done", status_id: "s-done", due_date: yesterday, deleted_at: null },
      // Not done but due in the future — not overdue.
      { id: "t3", project_id: "p1", status: "Todo", status_id: "s-todo", due_date: tomorrow, deleted_at: null },
      // Not done, due today — not overdue (strictly before today only).
      { id: "t4", project_id: "p1", status: "Todo", status_id: "s-todo", due_date: today, deleted_at: null },
    ];

    const result = await getMyProjectsProgress("w1", "u1");

    expect(result[0].overdueCount).toBe(1);
  });

  it("AS_052_only_returns_projects_where_the_user_is_a_member", async () => {
    memberRows = [
      {
        project_id: "p1",
        user_id: "u1",
        projects: { id: "p1", name: "Alpha", key: "ALP", workspace_id: "w1", deleted_at: null },
      },
      // Different user's membership — must not leak into u1's results.
      {
        project_id: "p2",
        user_id: "u2",
        projects: { id: "p2", name: "Beta", key: "BET", workspace_id: "w1", deleted_at: null },
      },
      // Same user, different workspace — must not leak across workspaces.
      {
        project_id: "p3",
        user_id: "u1",
        projects: { id: "p3", name: "Gamma", key: "GAM", workspace_id: "w2", deleted_at: null },
      },
      // Same user + workspace, but the project is archived (soft-deleted).
      {
        project_id: "p4",
        user_id: "u1",
        projects: { id: "p4", name: "Delta", key: "DEL", workspace_id: "w1", deleted_at: "2026-01-01" },
      },
    ];
    statusRows = [];
    taskRows = [];

    const result = await getMyProjectsProgress("w1", "u1");

    expect(result.map((r) => r.projectId)).toEqual(["p1"]);
  });

  it("returns an empty array when the user has no memberships", async () => {
    memberRows = [];
    statusRows = [];
    taskRows = [];

    const result = await getMyProjectsProgress("w1", "u1");

    expect(result).toEqual([]);
  });

  it("orders by overdueCount desc, then projectName asc", async () => {
    memberRows = [
      { project_id: "p1", user_id: "u1", projects: { id: "p1", name: "Zeta", key: "Z", workspace_id: "w1", deleted_at: null } },
      { project_id: "p2", user_id: "u1", projects: { id: "p2", name: "Alpha", key: "A", workspace_id: "w1", deleted_at: null } },
      { project_id: "p3", user_id: "u1", projects: { id: "p3", name: "Beta", key: "B", workspace_id: "w1", deleted_at: null } },
    ];
    statusRows = [
      { id: "s-todo", project_id: "p1", name: "Todo", category: "not_started", client_bucket: null },
      { id: "s-todo2", project_id: "p2", name: "Todo", category: "not_started", client_bucket: null },
      { id: "s-todo3", project_id: "p3", name: "Todo", category: "not_started", client_bucket: null },
    ];
    taskRows = [
      // p1: 1 overdue, p2: 1 overdue (tie -> alpha before zeta by name... but zeta comes first here)
      { id: "t1", project_id: "p1", status: "Todo", status_id: "s-todo", due_date: yesterday, deleted_at: null },
      { id: "t2", project_id: "p2", status: "Todo", status_id: "s-todo2", due_date: yesterday, deleted_at: null },
      // p3: no overdue tasks.
      { id: "t3", project_id: "p3", status: "Todo", status_id: "s-todo3", due_date: tomorrow, deleted_at: null },
    ];

    const result = await getMyProjectsProgress("w1", "u1");

    // p1 (Zeta) and p2 (Alpha) tie on overdueCount=1 -> name asc: Alpha before Zeta.
    // p3 (Beta) has overdueCount=0 -> last.
    expect(result.map((r) => r.projectName)).toEqual(["Alpha", "Zeta", "Beta"]);
  });
});
