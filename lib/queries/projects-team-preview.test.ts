import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const calls: string[] = [];
let mode: "ok" | "err" = "ok";
const rows = [
  { user_id: "u1", tasks: { project_id: "p1" } },
  { user_id: "u1", tasks: { project_id: "p1" } },
  ...["u2", "u3", "u4", "u5", "u6"].map((u) => ({ user_id: u, tasks: { project_id: "p1" } })),
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
      b.neq = (c: string, v: unknown) => (filters.push(`neq:${c}:${v}`), b);
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          mode === "err" ? { data: null, error: new Error("x") } : { data: rows, error: null },
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
    expect(filters).toContain("neq:tasks.status:done");
    expect(m.has("p2")).toBe(false);
  });
  it("test_PL_012_rejects_so_page_catch_can_fail_open", async () => {
    mode = "err";
    await expect(getProjectTeamPreview(["p1"])).rejects.toThrow();
    mode = "ok";
  });
});
