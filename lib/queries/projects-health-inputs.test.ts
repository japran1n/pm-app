import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const phases = [{ project_id: "p1", name: "Design", state: "active", planned_start: null, planned_end: null, position: 1 }];

function chain(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "in", "is", "eq", "order"]) b[m] = () => b;
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => chain(t === "project_phases" ? phases : []),
  })),
}));

import { getProjectHealthInputs } from "./projects";

describe("getProjectHealthInputs phase name", () => {
  it("test_PL_010_returns_active_phase_name_and_null_phase_when_none", async () => {
    const m = await getProjectHealthInputs(["p1", "p2"]);
    expect(m.get("p1")?.currentPhase?.name).toBe("Design");
    expect(m.get("p2")?.currentPhase).toBeNull();
  });
});
