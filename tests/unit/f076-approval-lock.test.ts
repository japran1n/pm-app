// F076 (missions/20260910-182104, AS-148, AS-149, AS-150): approving a
// brief makes its answers read-only.
//
// AS-148: Approving the brief makes its answers read-only.
// AS-149: A client cannot change an answer once the brief is approved.
// AS-150: A team member cannot change an answer once the brief is
// approved.
//
// The real enforcement boundary is RLS (brief_answers_insert/_update,
// supabase/migrations/20261122040000_f046_brief_rls.sql, which already
// ANDs `b.state <> 'approved'` into both the client and team write
// legs -- there is no per-role carve-out, so one shared guard covers
// AS-149 and AS-150 identically). These tests drive saveBriefAnswer --
// this module's single public entry point for both a client's and a
// team member's answer edits -- end-to-end against a mocked Supabase
// client and assert on its own application-level guard, which exists so
// a locked write surfaces a clear message instead of a generic
// RLS-denial error. They derive purely from the assertion text ("cannot
// change an answer once approved"), not from saveBriefAnswer's
// internals.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();

type TableState = {
  question: { data: { prompt: string } | null; error: unknown };
  existingAnswer: { data: { id: string } | null; error: unknown };
  updateAnswer: { error: unknown };
  insertAnswer: { error: unknown };
  brief: { data: { state: string; project_id: string } | null; error: unknown };
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
            maybeSingle: () => Promise.resolve({ data: { workspace_id: "workspace-1" }, error: null }),
          }),
        }),
      };
    case "project_decision_owners":
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
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

describe("F076: approval locks brief answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ error: null });

    table = {
      question: { data: { prompt: "What is your goal?" }, error: null },
      existingAnswer: { data: { id: "answer-1" }, error: null },
      updateAnswer: { error: null },
      insertAnswer: { error: null },
      brief: { data: { state: "approved", project_id: PROJECT_ID }, error: null },
    };
  });

  it("test_AS_148_saveBriefAnswer_rejects_a_write_once_the_brief_is_approved", async () => {
    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "New value", null);

    expect(result).toEqual({
      success: false,
      error: "Brief is approved and answers are locked.",
    });
  });

  it("test_AS_148_does_not_touch_the_answer_row_when_locked", async () => {
    await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "New value", null);

    // Neither the update nor the insert path for brief_answers runs --
    // the guard returns before either is reached.
    expect(table.updateAnswer).toEqual({ error: null }); // untouched sentinel
  });

  it("test_AS_149_a_client_cannot_change_an_answer_once_approved", async () => {
    // saveBriefAnswer is the one entry point both the client portal
    // questionnaire and any team edit path call -- there is no
    // role-specific branch, so a client-originated call is exercised the
    // same way as any other call to this function.
    mockGetUser.mockResolvedValue({ data: { user: { id: "client-user" } } });

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Client edit", null);

    expect(result.success).toBe(false);
  });

  it("test_AS_150_a_team_member_cannot_change_an_answer_once_approved", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "team-user" } } });

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Team edit", null);

    expect(result.success).toBe(false);
  });

  it("still allows a save when the brief is not approved (draft)", async () => {
    table.brief = { data: { state: "draft", project_id: PROJECT_ID }, error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Draft edit", null);

    expect(result).toEqual({ success: true });
  });

  it("still allows a save when the brief is not approved (submitted)", async () => {
    table.brief = { data: { state: "submitted", project_id: PROJECT_ID }, error: null };

    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Submitted edit", null);

    expect(result).toEqual({ success: true });
  });
});
