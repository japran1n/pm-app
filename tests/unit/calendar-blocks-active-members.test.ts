// F013 (missions/20260920-124226, AS-031): a deactivated member's blocks
// must never come back from getCalendarBlocks, even when their id is
// explicitly present in the `userIds` array passed in (F012's `?people=`
// filter). Mocks the Supabase client the same filter-honouring way
// tests/unit/portal-phases-query.test.ts does -- see that file's header
// comment for why a mock that ignores `.eq()`/`.in()` arguments can't
// prove the real code's filter is applied.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

let memberRows: Row[];
let blockRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "workspace_members") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              in: vi.fn(async (col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return { data: applyFilters(memberRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "calendar_blocks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              lt: vi.fn((col: string, val: unknown) => {
                filters.push((row) => String(row[col]) < String(val));
                return builder;
              }),
              gt: vi.fn((col: string, val: unknown) => {
                filters.push((row) => String(row[col]) > String(val));
                return builder;
              }),
              order: vi.fn(async () => {
                return { data: applyFilters(blockRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getCalendarBlocks } from "@/lib/queries/calendar-blocks";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_USER_ID = "22222222-2222-4222-8222-222222222222";
const DEACTIVATED_USER_ID = "33333333-3333-4333-8333-333333333333";
const RANGE_START = "2026-01-01T00:00:00.000Z";
const RANGE_END = "2026-02-01T00:00:00.000Z";

beforeEach(() => {
  memberRows = [
    { user_id: ACTIVE_USER_ID, workspace_id: WORKSPACE_ID, status: "active" },
    { user_id: DEACTIVATED_USER_ID, workspace_id: WORKSPACE_ID, status: "invited" },
  ];
  blockRows = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: WORKSPACE_ID,
      project_id: null,
      user_id: ACTIVE_USER_ID,
      title: "Active member block",
      starts_at: "2026-01-10T00:00:00.000Z",
      ends_at: "2026-01-10T01:00:00.000Z",
      color: null,
      block_type: "general",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: WORKSPACE_ID,
      project_id: null,
      user_id: DEACTIVATED_USER_ID,
      title: "Deactivated member block",
      starts_at: "2026-01-11T00:00:00.000Z",
      ends_at: "2026-01-11T01:00:00.000Z",
      color: null,
      block_type: "general",
    },
  ];
});

describe("AS-031: getCalendarBlocks excludes deactivated members' blocks", () => {
  it("test_AS_031_deactivated_member_id_yields_no_blocks_even_when_passed", async () => {
    const result = await getCalendarBlocks(WORKSPACE_ID, RANGE_START, RANGE_END, [
      DEACTIVATED_USER_ID,
    ]);

    expect(result).toEqual([]);
  });

  it("test_AS_031_active_member_id_still_returns_their_blocks", async () => {
    const result = await getCalendarBlocks(WORKSPACE_ID, RANGE_START, RANGE_END, [
      ACTIVE_USER_ID,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(ACTIVE_USER_ID);
  });

  it("test_AS_031_mixed_selection_only_returns_active_members_blocks", async () => {
    const result = await getCalendarBlocks(WORKSPACE_ID, RANGE_START, RANGE_END, [
      ACTIVE_USER_ID,
      DEACTIVATED_USER_ID,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(ACTIVE_USER_ID);
  });
});
