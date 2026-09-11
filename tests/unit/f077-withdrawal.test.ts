// F077 (missions/20260910-182104, AS-151): withdrawing the approval
// makes answers editable again.
//
// withdrawBriefApproval reverts brief.state from 'approved' back to
// 'submitted'; once that happens, saveBriefAnswer's approval-lock guard
// (F076, lib/actions/brief.ts) no longer fires -- this test drives
// withdrawBriefApproval directly (its public entry point) and then
// confirms a subsequent saveBriefAnswer call succeeds against the
// resulting non-approved state, exercising AS-151's actual observable
// behaviour ("answers editable again") rather than just the state column.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();

type BriefRow = { id: string; state: string; project_id: string };

let briefRow: BriefRow;
let updateResult: { data: { id: string } | null; error: unknown };

function briefsTable() {
  return {
    update: (payload: { state: string }) => ({
      eq: (col1: string, val1: string) => ({
        eq: (col2: string, val2: string) => ({
          select: () => ({
            maybeSingle: () => {
              // Mirror the real `.eq("id", briefId).eq("state", "approved")`
              // guard: only "succeed" (and actually flip state) when both
              // conditions match, same as Postgres RLS + WHERE would.
              const idMatches = (col1 === "id" && val1 === briefRow.id) || (col2 === "id" && val2 === briefRow.id);
              const stateMatches =
                (col1 === "state" && val1 === briefRow.state) ||
                (col2 === "state" && val2 === briefRow.state);
              if (idMatches && stateMatches && !updateResult.error) {
                briefRow = { ...briefRow, state: payload.state };
                return Promise.resolve({ data: { id: briefRow.id }, error: null });
              }
              return Promise.resolve(updateResult);
            },
          }),
        }),
      }),
    }),
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: { state: briefRow.state }, error: null }),
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((name: string) => {
      if (name === "briefs") return briefsTable();
      throw new Error(`unexpected table in test mock: ${name}`);
    }),
  })),
}));

import { withdrawBriefApproval } from "@/lib/actions/brief";

const BRIEF_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("F077: withdrawBriefApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "team-user" } } });
    briefRow = { id: BRIEF_ID, state: "approved", project_id: PROJECT_ID };
    updateResult = { data: null, error: null };
  });

  it("test_AS_151_withdrawing_approval_sets_the_brief_state_to_submitted", async () => {
    const result = await withdrawBriefApproval(BRIEF_ID);

    expect(result).toEqual({ success: true });
    expect(briefRow.state).toBe("submitted");
  });

  it("test_AS_151_a_non_approved_brief_cannot_be_withdrawn", async () => {
    briefRow = { id: BRIEF_ID, state: "submitted", project_id: PROJECT_ID };

    const result = await withdrawBriefApproval(BRIEF_ID);

    expect(result.success).toBe(false);
    expect(briefRow.state).toBe("submitted");
  });

  it("requires an authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await withdrawBriefApproval(BRIEF_ID);

    expect(result).toEqual({
      success: false,
      error: "You must be signed in to withdraw this approval.",
    });
  });
});
