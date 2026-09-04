// Unit test for F087 (perf audit item 6): lib/queries/search.ts's
// searchWorkspaceTasks used to call `.rpc("search_tasks", { p_project_id,
// p_query })` once PER PROJECT in the workspace
// (`projects.map(async (project) => supabase.rpc(...))`), fanning a
// single debounced keystroke out into N round-trips. Fixed by adding
// `search_tasks_multi(p_project_ids uuid[], p_query text)`
// (supabase/migrations/20261027010000_f087_search_tasks_multi_project.sql)
// and calling it ONCE with every project id in the workspace.
//
// This test mocks the Supabase server/admin clients and
// `requireActiveMembership` (mirrors tests/unit/portal-preview-action
// .test.ts's mocked-client pattern) so it can assert the RPC call count
// directly, independent of the real linked project's data — the
// behavioural, end-to-end "results are still correct" coverage already
// exists in tests/integration/search-tasks.test.ts and its siblings,
// which this change does not weaken (still passing against the real RPC).

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: "member" })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

const rpcCalls: { name: string; args: unknown }[] = [];

const PROJECTS = [
  { id: "project-1", name: "Alpha", key: "AL" },
  { id: "project-2", name: "Beta", key: "BE" },
  { id: "project-3", name: "Gamma", key: "GA" },
];

function makeMemberClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ data: PROJECTS, error: null }),
            }),
          }),
        };
      }
      if (table === "project_statuses") {
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "tasks") {
        // Exact-key-match lookup path (`parseTaskKeyQuery` returns null
        // for this test's free-text query, so this branch is never
        // reached, but the shape must exist to avoid a crash if it were).
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test mock: ${table}`);
    },
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: [], error: null };
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeMemberClient(),
}));

import { searchWorkspaceTasks } from "@/lib/queries/search";

describe("test_search_workspace_tasks_issues_one_rpc_for_the_whole_workspace", () => {
  it("calls search_tasks_multi exactly once with every project id, not one search_tasks call per project", async () => {
    rpcCalls.length = 0;
    await searchWorkspaceTasks("workspace-1", "release");

    const multiCalls = rpcCalls.filter((call) => call.name === "search_tasks_multi");
    const perProjectCalls = rpcCalls.filter((call) => call.name === "search_tasks");

    expect(perProjectCalls).toHaveLength(0);
    expect(multiCalls).toHaveLength(1);
    expect(multiCalls[0]!.args).toEqual({
      p_project_ids: ["project-1", "project-2", "project-3"],
      p_query: "release",
    });
  });
});
