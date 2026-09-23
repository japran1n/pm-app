import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
let mode: "ok" | "err" = "ok";
// PL-013: "done" is resolved via project_statuses.category, never the
// literal `tasks.status` text — u7 is assigned only to a task whose
// status_id resolves (via statusRows below) to category "done" and must
// never appear in the result.
const rows = [
  { user_id: "u1", tasks: { project_id: "p1", status: "open", status_id: "s-open" } },
  { user_id: "u1", tasks: { project_id: "p1", status: "open", status_id: "s-open" } },
  ...["u2", "u3", "u4", "u5", "u6"].map((u) => ({
    user_id: u,
    tasks: { project_id: "p1", status: "open", status_id: "s-open" },
  })),
  { user_id: "u7", tasks: { project_id: "p1", status: "done", status_id: "s-done" } },
];
const statusRows = [
  { id: "s-open", project_id: "p1", name: "In Progress", category: "in_progress", client_bucket: null },
  { id: "s-done", project_id: "p1", name: "Done", category: "done", client_bucket: null },
];
const filters: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => {
      calls.push(t);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = () => b;
      b.is = (c: string, v: unknown) => (filters.push(`is:${c}:${v}`), b);
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          mode === "err"
            ? { data: null, error: new Error("x") }
            : t === "task_assignees"
              ? { data: rows, error: null }
              : { data: statusRows, error: null },
        ).then(res);
      return b;
    },
  })),
}));
vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async (ids: string[]) => new Map(ids.map((i) => [i, { name: i, email: null, avatarUrl: null }]))),
}));

import { getProjectTeamPreview } from "./projects";

describe("getProjectTeamPreview", () => {
  it("test_PL_011_batched_max4_distinct_with_total", async () => {
    const m = await getProjectTeamPreview(["p1", "p2", "p3"]);
    expect(calls.filter((c) => c === "task_assignees")).toHaveLength(1);
    expect(m.get("p1")?.people).toHaveLength(4);
    expect(m.get("p1")?.total).toBe(6);
  });
  it("test_PL_013_excludes_done_deleted_and_empty_projects", async () => {
    filters.length = 0;
    const m = await getProjectTeamPreview(["p1", "p2"]);
    expect(filters).toContain("is:tasks.deleted_at:null");
    // "done" is resolved via project_statuses.category, not the literal
    // tasks.status text: u7 (assigned only to the "s-done" status, whose
    // category is "done") never appears even though the DB-level filter no
    // longer does a `.neq("tasks.status", "done")`.
    expect(m.get("p1")?.people.map((p) => p.id)).not.toContain("u7");
    expect(m.get("p1")?.total).toBe(6);
    expect(m.has("p2")).toBe(false);
  });
  it("test_PL_012_rejects_so_page_catch_can_fail_open", async () => {
    mode = "err";
    await expect(getProjectTeamPreview(["p1"])).rejects.toThrow();
    mode = "ok";
  });
});
