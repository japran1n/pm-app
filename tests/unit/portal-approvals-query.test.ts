// F079 (missions/20260903-portal audit, defect 1): unit coverage for the
// error-vs-empty distinction in getOpenApprovalsForClient / getApprovalHistory
// / getDecisionOwners (lib/queries/approvals.ts).
//
// Before this fix, a failed read from any of these three functions was
// caught, logged, and coalesced to `[]` -- the exact same shape as
// "genuinely nothing here yet". A client reading "Nothing waiting on you"
// after a database blip stops looking, and an overdue approval slips.
// These functions now return `PortalQueryResult<T>` (lib/queries/portal.ts's
// own `{ ok }` discriminant), and the tests below assert `{ ok: false }` on
// a failed read and `{ ok: true, data: [] }` on a genuinely empty one --
// two DIFFERENT values a caller must handle differently, not the same `[]`
// a page's `.length === 0` check can't tell apart.
//
// Same mocked-Supabase-client + `applyFilters` shape as
// tests/unit/portal-phases-query.test.ts, which this file's own defect
// (F006f) is the direct precedent for.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, eqFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

type MockError = { message: string } | null;

let approvalRows: Row[];
let ownerRows: Row[];
let approvalsError: MockError;
let ownersError: MockError;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "approval_requests") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              neq: vi.fn((col: string, val: unknown) => {
                filters.push((row: Row) => row[col] !== val);
                return builder;
              }),
              order: vi.fn(async () => {
                if (approvalsError) return { data: null, error: approvalsError };
                return { data: applyFilters(approvalRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_decision_owners") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn(async (col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                if (ownersError) return { data: null, error: ownersError };
                return { data: applyFilters(ownerRows, filters), error: null };
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

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async () => new Map()),
}));

import {
  getOpenApprovalsForClient,
  getApprovalHistory,
  getDecisionOwners,
} from "@/lib/queries/approvals";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  approvalRows = [];
  ownerRows = [];
  approvalsError = null;
  ownersError = null;
});

describe("getOpenApprovalsForClient — F079 defect 1: a failed read is not an empty list", () => {
  it("test_open_approvals_failed_read_returns_ok_false_not_an_empty_array", async () => {
    approvalsError = { message: "connection reset" };

    const result = await getOpenApprovalsForClient(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });

  it("test_open_approvals_genuinely_empty_returns_ok_true_with_empty_data", async () => {
    approvalRows = [];

    const result = await getOpenApprovalsForClient(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: [] });
  });

  it("test_open_approvals_returns_pending_rows_scoped_to_the_project", async () => {
    approvalRows = [
      {
        id: "a1",
        project_id: PROJECT_ID,
        title: "Homepage copy",
        description: null,
        decision_type: "content",
        subject_type: "artifact",
        subject_id: null,
        artifact_url: null,
        artifact_snapshot_path: null,
        state: "pending",
        requested_at: "2026-01-01T00:00:00Z",
        due_at: null,
        decided_at: null,
        decision_note: null,
        decided_by: null,
        round: 1,
      },
    ];

    const result = await getOpenApprovalsForClient(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("a1");
  });
});

describe("getApprovalHistory — F079 defect 1: a failed read is not an empty list", () => {
  it("test_approval_history_failed_read_returns_ok_false_not_an_empty_array", async () => {
    approvalsError = { message: "connection reset" };

    const result = await getApprovalHistory(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });

  it("test_approval_history_genuinely_empty_returns_ok_true_with_empty_data", async () => {
    approvalRows = [];

    const result = await getApprovalHistory(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("getDecisionOwners — F079 defect 1: a failed read is not an empty list", () => {
  it("test_decision_owners_failed_read_returns_ok_false_not_an_empty_array", async () => {
    ownersError = { message: "connection reset" };

    const result = await getDecisionOwners(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });

  it("test_decision_owners_genuinely_empty_returns_ok_true_with_empty_data", async () => {
    ownerRows = [];

    const result = await getDecisionOwners(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: [] });
  });
});
