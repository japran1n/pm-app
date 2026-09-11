// F068 (missions/20260910-182104, AS-136, AS-137): saveBriefAnswer fans
// out a `brief_answer_changed` notification to a project's decision
// owners (project_decision_owners) when an already-answered question is
// changed AFTER the brief has been submitted (state 'submitted' or
// 'approved'), and sends no notification for a change made while the
// brief is still 'draft'.
//
// These tests derive from the assertion text ("changing an answer after
// submission notifies the configured recipients" / "changing an answer
// before submission sends no notification"), not from
// notifyDecisionOwnersOfAnswerChange's internals: each test drives
// saveBriefAnswer end-to-end (its real public entry point) against a
// mocked Supabase client and asserts on whether the `create_notification`
// RPC was called, not on any private helper.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();

// Per-table response state, reconfigured in beforeEach/each test.
type TableState = {
  question: { data: { prompt: string } | null; error: unknown };
  existingAnswer: { data: { id: string } | null; error: unknown };
  updateAnswer: { error: unknown };
  insertAnswer: { error: unknown };
  brief: { data: { state: string; project_id: string } | null; error: unknown };
  project: { data: { workspace_id: string } | null; error: unknown };
  owners: { data: { user_id: string }[] | null; error: unknown };
};

let table: TableState;

function fromImpl(name: string) {
  switch (name) {
    case "brief_questions":
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(table.question),
          }),
        }),
      };
    case "brief_answers":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(table.existingAnswer),
            }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve(table.updateAnswer),
        }),
        insert: () => Promise.resolve(table.insertAnswer),
      };
    case "briefs":
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(table.brief),
          }),
        }),
      };
    case "projects":
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(table.project),
          }),
        }),
      };
    case "project_decision_owners":
      return {
        select: () => ({
          eq: () => Promise.resolve(table.owners),
        }),
      };
    default:
      throw new Error(`unexpected table in test mock: ${name}`);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(fromImpl),
    rpc: mockRpc,
  })),
}));

import { saveBriefAnswer } from "@/lib/actions/brief";

const BRIEF_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";

describe("F068: saveBriefAnswer post-submission change notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ error: null });

    table = {
      question: { data: { prompt: "What is your goal?" }, error: null },
      // An *existing* answer -- this is the "changing an answer" path,
      // not a first-time answer.
      existingAnswer: { data: { id: "answer-1" }, error: null },
      updateAnswer: { error: null },
      insertAnswer: { error: null },
      brief: { data: { state: "submitted", project_id: PROJECT_ID }, error: null },
      project: { data: { workspace_id: "workspace-1" }, error: null },
      owners: { data: [{ user_id: OWNER_ID }], error: null },
    };
  });

  it("test_AS_136_changing_an_answer_after_submission_notifies_decision_owners", async () => {
    table.brief = { data: { state: "submitted", project_id: PROJECT_ID }, error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith(
      "create_notification",
      expect.objectContaining({
        p_user_id: OWNER_ID,
        p_kind: "brief_answer_changed",
        p_workspace_id: "workspace-1",
      }),
    );
  });

  // F076 (AS-149/AS-150) superseded this: once a brief is 'approved',
  // saveBriefAnswer's own approval-lock guard rejects the write before
  // it ever reaches the "changed after submission" notification path
  // below -- an approved brief can no longer be the subject of a
  // notified change at all, since it can't be changed. See
  // tests/unit/f076-approval-lock.test.ts for the lock itself.
  it("test_AS_137_does_not_notify_when_brief_is_approved_because_the_write_is_locked", async () => {
    table.brief = { data: { state: "approved", project_id: PROJECT_ID }, error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(result).toEqual({ success: false, error: "Brief is approved and answers are locked." });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("test_AS_137_changing_an_answer_before_submission_sends_no_notification", async () => {
    table.brief = { data: { state: "draft", project_id: PROJECT_ID }, error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(result).toEqual({ success: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("test_AS_137_no_notification_attempted_for_a_first_time_answer_even_when_submitted", async () => {
    // Not a "change" -- no existing answer row yet.
    table.existingAnswer = { data: null, error: null };
    table.brief = { data: { state: "submitted", project_id: PROJECT_ID }, error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "First answer", null);

    expect(result).toEqual({ success: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not fail the save if there are no decision owners configured", async () => {
    table.owners = { data: [], error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(result).toEqual({ success: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not fail the save if the notification RPC errors", async () => {
    mockRpc.mockResolvedValue({ error: { message: "boom" } });

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(result).toEqual({ success: true });
  });
});
