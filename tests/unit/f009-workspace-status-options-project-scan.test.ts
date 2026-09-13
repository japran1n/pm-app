// Unit test for F009 (missions/20260913-perf-latency, M2 — Query narrowing):
// `getWorkspaceStatusOptions` (lib/queries/calendar.ts). Covers AS-008
// (the `project_statuses` query is constrained by an explicit project id
// list resolved from the workspace's visible projects, not a join/filter
// across the whole table) and AS-011 (the returned set and order are
// unchanged from the pre-narrowing behaviour).
//
// Mocks `createClient` the same way other query-narrowing tests in this
// mission do: a fake supabase client whose `.from()` records the table
// name and filter chain so the test can assert *which* table was queried
// with *which* constraint, without touching a real database.

import { describe, expect, it, vi } from "vitest";

const calls: { table: string; ins: Record<string, unknown[]> }[] = [];

function makeChain(table: string, resolvedData: unknown[], terminal: "is" | "order") {
  const record: { table: string; ins: Record<string, unknown[]> } = { table, ins: {} };
  calls.push(record);

  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = (column: string, values: unknown[]) => {
    record.ins[column] = values;
    return chain;
  };
  if (terminal === "is") {
    chain.is = () => Promise.resolve({ data: resolvedData, error: null });
  } else {
    chain.is = () => chain;
    chain.order = () => Promise.resolve({ data: resolvedData, error: null });
  }
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "projects") {
        return makeChain("projects", [{ id: "p1" }, { id: "p2" }], "is");
      }
      if (table === "project_statuses") {
        return makeChain(
          "project_statuses",
          [
            { name: "To Do", color: "#111", category: "todo", position: 0 },
            { name: "Done", color: "#222", category: "done", position: 1 },
          ],
          "order",
        );
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { getWorkspaceStatusOptions } from "@/lib/queries/calendar";

describe("F009: getWorkspaceStatusOptions constrained by project id", () => {
  it("AS-008: scopes the project_statuses query with an explicit project id list", async () => {
    await getWorkspaceStatusOptions("ws-1");

    const statusesCall = calls.find((c) => c.table === "project_statuses");
    expect(statusesCall).toBeDefined();
    expect(statusesCall?.ins.project_id).toEqual(["p1", "p2"]);
  });

  it("AS-011: returns the same set and order as before narrowing", async () => {
    const result = await getWorkspaceStatusOptions("ws-1");

    expect(result).toEqual([
      { name: "To Do", color: "#111", category: "todo" },
      { name: "Done", color: "#222", category: "done" },
    ]);
  });

  it("AS-011: returns an empty list when the workspace has no visible projects, without querying project_statuses", async () => {
    calls.length = 0;
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      from: (table: string) => {
        if (table === "projects") {
          return makeChain("projects", [], "is");
        }
        throw new Error(`unexpected table ${table}`);
      },
    }));

    const result = await getWorkspaceStatusOptions("ws-empty");

    expect(result).toEqual([]);
    expect(calls.some((c) => c.table === "project_statuses")).toBe(false);
  });
});
