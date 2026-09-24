// SEC-ACT4-07 / GAP3-04: saveBriefAnswer validates and bounds its input,
// pins the question to the brief's project, upserts on (brief_id,
// question_id), skips unchanged saves; generateBriefDocument escapes
// client-authored answers before composing Markdown.
import { beforeEach, describe, expect, it, vi } from "vitest";

const BRIEF_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";

let question: Record<string, unknown> | null;
let brief: Record<string, unknown> | null;
let existing: Record<string, unknown> | null;
const upsert = vi.fn(async () => ({ error: null }));
const docInsert = vi.fn();

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  Object.assign(c, {
    select: () => c,
    eq: () => c,
    maybeSingle: async () => result,
  });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: vi.fn(async () => ({ error: null })),
    from: (table: string) => {
      if (table === "brief_questions") return chain({ data: question, error: null });
      if (table === "briefs") return chain({ data: brief, error: null });
      if (table === "brief_answers") {
        return { ...chain({ data: existing, error: null }), upsert };
      }
      if (table === "projects") {
        return chain({ data: { workspace_id: "ws-1", workspaces: { slug: "acme" } }, error: null });
      }
      if (table === "project_decision_owners") {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      if (table === "docs") {
        return {
          insert: (row: unknown) => {
            docInsert(row);
            return { select: () => ({ single: async () => ({ data: { id: "doc-1" }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getBrief = vi.fn();
vi.mock("@/lib/queries/brief", () => ({ getBrief: (...a: unknown[]) => getBrief(...a) }));

import { generateBriefDocument, saveBriefAnswer } from "@/lib/actions/brief";

beforeEach(() => {
  upsert.mockClear();
  docInsert.mockClear();
  question = { prompt: "Goal?", project_id: PROJECT_ID, answer_type: "long_text", options: null };
  brief = { state: "draft", project_id: PROJECT_ID };
  existing = null;
});

describe("saveBriefAnswer hardening", () => {
  it("rejects non-uuid ids and oversize answers without touching the DB", async () => {
    expect((await saveBriefAnswer("nope", QUESTION_ID, "x", null)).success).toBe(false);
    expect((await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "x".repeat(10_001), null)).success).toBe(false);
    expect(
      (await saveBriefAnswer(BRIEF_ID, QUESTION_ID, null, Array.from({ length: 51 }, (_, i) => `o${i}`))).success,
    ).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a question from another project", async () => {
    question = { ...question!, project_id: OTHER_PROJECT };
    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "x", null);
    expect(result.success).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects choice answers that are not among the question's options", async () => {
    question = { ...question!, answer_type: "single_choice", options: ["A", "B"] };
    expect((await saveBriefAnswer(BRIEF_ID, QUESTION_ID, null, ["C"])).success).toBe(false);
    expect((await saveBriefAnswer(BRIEF_ID, QUESTION_ID, null, ["A", "B"])).success).toBe(false);
    expect((await saveBriefAnswer(BRIEF_ID, QUESTION_ID, null, ["A"])).success).toBe(true);
  });

  it("upserts on (brief_id, question_id)", async () => {
    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "hello", null);
    expect(result).toEqual({ success: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ brief_id: BRIEF_ID, question_id: QUESTION_ID, answer_text: "hello" }),
      { onConflict: "brief_id,question_id" },
    );
  });

  it("an unchanged re-save writes nothing", async () => {
    existing = { id: "a1", answer_text: "hello", answer_options: null };
    const result = await saveBriefAnswer(BRIEF_ID, QUESTION_ID, "hello", null);
    expect(result).toEqual({ success: true });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("generateBriefDocument escaping (GAP3-04)", () => {
  it("escapes HTML and Markdown in answers", async () => {
    getBrief.mockResolvedValue({
      ok: true,
      data: {
        brief: { id: BRIEF_ID },
        questions: [
          { id: QUESTION_ID, prompt: "Goal?", category: "overview", position: 1 },
        ],
        answers: [
          {
            id: "a1",
            questionId: QUESTION_ID,
            answerText: '<img src=x onerror=alert(1)> [click](https://evil.test)\n# Heading',
            answerOptions: null,
          },
        ],
      },
    });

    const result = await generateBriefDocument(PROJECT_ID, BRIEF_ID);
    expect(result.success).toBe(true);
    const content = (docInsert.mock.calls[0][0] as { content: string }).content;
    expect(content).not.toMatch(/(^|[^\\])<img/);
    expect(content).toContain("\\<img");
    expect(content).toContain("\\[click\\]\\(https\\://evil\\.test\\)");
    expect(content).toContain("\\# Heading");
    expect(content).toContain("**Goal?**");
  });
});
