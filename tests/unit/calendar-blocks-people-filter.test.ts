// F012 (AS-005, AS-006, AS-029): getCalendarBlocks accepts an ordered
// userIds list and applies it as a database-level `.in("user_id", ...)`
// restriction on the query itself, never as a post-fetch filter.
//
// Mocks a chainable query-builder stub over an in-memory row set, following
// the minimal chainable-stub convention tests/unit/f031-component-guards.test.ts
// already established for query modules that go through
// `@/lib/supabase/server`.

import { describe, expect, it, vi, beforeEach } from "vitest";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const USER_A = "20000000-0000-4000-8000-000000000002";
const USER_B = "30000000-0000-4000-8000-000000000003";
const USER_UNKNOWN = "40000000-0000-4000-8000-000000000004";

const MEMBER_ROWS = [
  { workspace_id: WORKSPACE_ID, user_id: USER_A, status: "active" },
  { workspace_id: WORKSPACE_ID, user_id: USER_B, status: "active" },
];

type Row = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  user_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  color: string | null;
  block_type: string | null;
};

const ALL_ROWS: Row[] = [
  {
    id: "block-a1",
    workspace_id: WORKSPACE_ID,
    project_id: null,
    user_id: USER_A,
    title: "A's block",
    starts_at: "2026-03-10T08:00:00.000Z",
    ends_at: "2026-03-10T09:00:00.000Z",
    color: null,
    block_type: "general",
  },
  {
    id: "block-b1",
    workspace_id: WORKSPACE_ID,
    project_id: null,
    user_id: USER_B,
    title: "B's block",
    starts_at: "2026-03-10T10:00:00.000Z",
    ends_at: "2026-03-10T11:00:00.000Z",
    color: null,
    block_type: "general",
  },
];

// Records whether the blocks table's `.in()` was invoked and with what
// args, so the test can assert the restriction happens IN the query
// (AS-029), not afterward.
let blocksInCalls: Array<{ column: string; values: string[] }> = [];
let dbHit = false;

function makeMembersBuilder() {
  let rows: typeof MEMBER_ROWS = MEMBER_ROWS;
  const builder = {
    select: () => builder,
    eq: (column: "workspace_id" | "status", value: string) => {
      rows = rows.filter((r) => r[column] === value);
      return builder;
    },
    in: async (column: string, values: string[]) => {
      rows = rows.filter((r) => values.includes(r.user_id));
      return { data: rows, error: null };
    },
  };
  return builder;
}

function makeBlocksBuilder() {
  let rows = ALL_ROWS;
  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => {
      if (column === "workspace_id") {
        rows = rows.filter((r) => r.workspace_id === value);
      }
      return builder;
    },
    in: (column: string, values: string[]) => {
      blocksInCalls.push({ column, values });
      rows = rows.filter((r) => values.includes(r.user_id));
      return builder;
    },
    lt: () => builder,
    gt: () => builder,
    order: async () => {
      dbHit = true;
      return { data: rows, error: null };
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => (table === "workspace_members" ? makeMembersBuilder() : makeBlocksBuilder()),
  }),
}));

beforeEach(() => {
  blocksInCalls = [];
  dbHit = false;
});

describe("getCalendarBlocks people filter (F012)", () => {
  it("test_AS_005_single_userId_returns_only_that_users_blocks", async () => {
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");

    const result = await getCalendarBlocks(
      WORKSPACE_ID,
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      [USER_A],
    );

    expect(result.map((b) => b.id)).toEqual(["block-a1"]);
    expect(result.every((b) => b.userId === USER_A)).toBe(true);
  });

  it("test_AS_006_multiple_userIds_returns_blocks_for_all_specified_users", async () => {
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");

    const result = await getCalendarBlocks(
      WORKSPACE_ID,
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      [USER_A, USER_B],
    );

    const resultIds = result.map((b) => b.id);
    expect(resultIds).toHaveLength(2);
    expect(resultIds).toEqual(expect.arrayContaining(["block-a1", "block-b1"]));

    // Results are sorted by starts_at ascending (the .order("starts_at")
    // is already applied in the implementation).
    const startsAtTimes = result.map((b) => new Date(b.startsAt).getTime());
    const sortedTimes = [...startsAtTimes].sort((a, b) => a - b);
    expect(startsAtTimes).toEqual(sortedTimes);
  });

  it("test_AS_029_unknown_userId_in_list_returns_no_blocks_for_that_id", async () => {
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");

    const result = await getCalendarBlocks(
      WORKSPACE_ID,
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      [USER_UNKNOWN],
    );

    expect(result).toEqual([]);
  });

  it("test_AS_029_the_restriction_is_applied_inside_the_query_via_in_clause", async () => {
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");

    await getCalendarBlocks(
      WORKSPACE_ID,
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      [USER_A],
    );

    expect(blocksInCalls).toEqual([{ column: "user_id", values: [USER_A] }]);
  });

  it("test_AS_029_empty_userIds_returns_empty_array_without_a_db_call", async () => {
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");

    const result = await getCalendarBlocks(
      WORKSPACE_ID,
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
      [],
    );

    expect(result).toEqual([]);
    expect(dbHit).toBe(false);
  });
});
