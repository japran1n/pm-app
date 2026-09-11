// F069 (missions/20260910-182104, AS-138): "the recipients of the change
// notification are configurable per project." F068 already fans the
// brief_answer_changed notification out to project_decision_owners
// (lib/notifications/fanout.ts's notifyDecisionOwnersOfAnswerChange,
// called from lib/actions/brief.ts's saveBriefAnswer) -- that table is
// scoped by project_id and editable per project through project
// settings' "Who approves what" (components/approvals/decision-owners.tsx,
// lib/actions/approvals.ts's setDecisionOwner).
//
// These tests derive from AS-138's text, not from the implementation:
// they drive saveBriefAnswer (the real entry point) against a mocked
// Supabase client and assert (1) the notification recipients come from
// whatever rows project_decision_owners has for THAT project, and (2)
// two different projects with different owner rows produce different
// recipients -- i.e. the set is per-project configurable, not hardcoded.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockRpc = vi.fn();

type TableState = {
  question: { data: { prompt: string } | null; error: unknown };
  existingAnswer: { data: { id: string } | null; error: unknown };
  updateAnswer: { error: unknown };
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
          eq: () => ({ maybeSingle: () => Promise.resolve(table.question) }),
        }),
      };
    case "brief_answers":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(table.existingAnswer) }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve(table.updateAnswer) }),
      };
    case "briefs":
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(table.brief) }),
        }),
      };
    case "projects":
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(table.project) }),
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
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_B1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER_B2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function resetTable(overrides: Partial<TableState>) {
  table = {
    question: { data: { prompt: "What is your goal?" }, error: null },
    existingAnswer: { data: { id: "answer-1" }, error: null },
    updateAnswer: { error: null },
    brief: { data: { state: "submitted", project_id: PROJECT_A }, error: null },
    project: { data: { workspace_id: "workspace-1" }, error: null },
    owners: { data: [], error: null },
    ...overrides,
  };
}

describe("F069: notification recipients are configurable per project (AS-138)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ error: null });
  });

  it("test_AS_138_fanout_uses_this_projects_configured_decision_owners", async () => {
    resetTable({
      brief: { data: { state: "submitted", project_id: PROJECT_A }, error: null },
      owners: { data: [{ user_id: OWNER_A }], error: null },
    });

    await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(mockRpc).toHaveBeenCalledWith(
      "create_notification",
      expect.objectContaining({ p_user_id: OWNER_A, p_kind: "brief_answer_changed" }),
    );
  });

  it("test_AS_138_different_projects_can_have_different_recipients", async () => {
    // Project A has one decision owner configured.
    resetTable({
      brief: { data: { state: "submitted", project_id: PROJECT_A }, error: null },
      owners: { data: [{ user_id: OWNER_A }], error: null },
    });
    await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);
    const projectARecipients = mockRpc.mock.calls
      .filter(([fn]) => fn === "create_notification")
      .map(([, args]) => (args as { p_user_id: string }).p_user_id);
    expect(projectARecipients).toEqual([OWNER_A]);

    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockRpc.mockResolvedValue({ error: null });

    // Project B has two different decision owners configured.
    resetTable({
      brief: { data: { state: "submitted", project_id: PROJECT_B }, error: null },
      owners: { data: [{ user_id: OWNER_B1 }, { user_id: OWNER_B2 }], error: null },
    });
    await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);
    const projectBRecipients = mockRpc.mock.calls
      .filter(([fn]) => fn === "create_notification")
      .map(([, args]) => (args as { p_user_id: string }).p_user_id)
      .sort();
    expect(projectBRecipients).toEqual([OWNER_B1, OWNER_B2].sort());

    // The two projects' recipient sets differ -- proving the recipient
    // list is per-project, not a fixed/global set.
    expect(projectARecipients).not.toEqual(projectBRecipients);
  });

  it("test_AS_138_project_with_no_configured_owners_notifies_no_one", async () => {
    resetTable({
      brief: { data: { state: "submitted", project_id: PROJECT_A }, error: null },
      owners: { data: [], error: null },
    });

    await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "Updated answer", null);

    expect(mockRpc).not.toHaveBeenCalledWith("create_notification", expect.anything());
  });
});
