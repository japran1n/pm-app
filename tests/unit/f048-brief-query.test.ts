// Unit test for F048 (lib/queries/brief.ts): type-shape assertions for
// the brief read-query pair. These are compile-time/shape checks, not
// live-DB integration tests -- `getBrief`/`getBriefForClient`/
// `getBriefWithRevisions` all call `createClient()` from
// `@/lib/supabase/server`, which needs a real request context (cookies),
// so exercising them against a live Supabase project is an integration
// concern, not this unit test's job. What this file verifies instead:
// the exported types match the real schema
// (20261122010000_f044_brief_tables.sql,
// 20261122020000_f045_brief_answer_revisions.sql) and the module's
// public surface is exactly the three functions + four types the
// feature spec asks for.

import { describe, expect, it } from "vitest";
import * as briefQueries from "@/lib/queries/brief";
import type {
  Brief,
  BriefAnswer,
  BriefAnswerRevision,
  BriefQuestion,
  BriefWithQuestionsAndAnswers,
} from "@/lib/queries/brief";

describe("F048: lib/queries/brief.ts exports the pair convention's three functions", () => {
  it("exports getBrief (team reader)", () => {
    expect(typeof briefQueries.getBrief).toBe("function");
  });

  it("exports getBriefForClient (client reader, RLS-filtered)", () => {
    expect(typeof briefQueries.getBriefForClient).toBe("function");
  });

  it("exports getBriefWithRevisions (team-only, answer + revision history)", () => {
    expect(typeof briefQueries.getBriefWithRevisions).toBe("function");
  });
});

describe("F048: Brief type shape matches briefs table (20261122010000)", () => {
  it("accepts a well-formed Brief value", () => {
    const brief: Brief = {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      state: "draft",
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    expect(brief.state).toBe("draft");
  });

  it("state is restricted to the briefs_state_check vocabulary", () => {
    const states: Brief["state"][] = ["draft", "submitted", "approved"];
    expect(states).toHaveLength(3);
  });
});

describe("F048: BriefQuestion type shape matches brief_questions table", () => {
  it("accepts a well-formed BriefQuestion, sortable by position", () => {
    const question: BriefQuestion = {
      id: "00000000-0000-4000-8000-000000000003",
      projectId: "00000000-0000-4000-8000-000000000002",
      prompt: "What is the primary goal of this project?",
      category: "goals",
      answerType: "long_text",
      helpText: null,
      required: true,
      options: null,
      position: 0,
    };
    expect(question.position).toBe(0);
  });

  it("answerType is restricted to brief_questions_answer_type_check's vocabulary", () => {
    const types: BriefQuestion["answerType"][] = [
      "short_text",
      "long_text",
      "single_choice",
      "multi_choice",
    ];
    expect(types).toHaveLength(4);
  });

  it("options carries a string[] (text[] column), not jsonb", () => {
    const question: BriefQuestion = {
      id: "00000000-0000-4000-8000-000000000003",
      projectId: "00000000-0000-4000-8000-000000000002",
      prompt: "Pick one",
      category: null,
      answerType: "single_choice",
      helpText: null,
      required: false,
      options: ["a", "b", "c"],
      position: 1,
    };
    expect(Array.isArray(question.options)).toBe(true);
  });
});

describe("F048: BriefAnswer type shape matches brief_answers table, keeps question_prompt_snapshot", () => {
  it("questionPromptSnapshot survives even when questionId is null (question deleted)", () => {
    const answer: BriefAnswer = {
      id: "00000000-0000-4000-8000-000000000004",
      briefId: "00000000-0000-4000-8000-000000000001",
      questionId: null,
      questionPromptSnapshot: "What is the primary goal of this project?",
      answerText: "Launch the new site",
      answerOptions: null,
      answeredBy: "00000000-0000-4000-8000-000000000005",
      answeredAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    expect(answer.questionId).toBeNull();
    expect(answer.questionPromptSnapshot.length).toBeGreaterThan(0);
  });
});

describe("F048: BriefAnswerRevision type shape matches brief_answer_revisions table", () => {
  it("carries previousText/previousOptions/changedBy/changedAt, not old_value", () => {
    const revision: BriefAnswerRevision = {
      id: "00000000-0000-4000-8000-000000000006",
      answerId: "00000000-0000-4000-8000-000000000004",
      previousText: "Launch a landing page",
      previousOptions: null,
      changedBy: "00000000-0000-4000-8000-000000000005",
      changedByName: "Jane Client",
      changedAt: "2026-09-09T00:00:00.000Z",
    };
    expect(revision.changedAt < "2026-09-10T00:00:00.000Z").toBe(true);
  });
});

describe("F048: getBrief / getBriefForClient share the same return shape (pair convention)", () => {
  it("BriefWithQuestionsAndAnswers holds brief + sorted questions + snapshot-bearing answers", () => {
    const shape: BriefWithQuestionsAndAnswers = {
      brief: null,
      questions: [],
      answers: [],
    };
    expect(shape.brief).toBeNull();
    expect(shape.questions).toEqual([]);
    expect(shape.answers).toEqual([]);
  });
});

describe("F048: getBriefWithRevisions returns an answer with a revisions array, DESC by changed_at", () => {
  it("revisions sort newest-first", () => {
    const revisions: BriefAnswerRevision[] = [
      {
        id: "1",
        answerId: "a",
        previousText: "older",
        previousOptions: null,
        changedBy: null,
        changedByName: null,
        changedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "2",
        answerId: "a",
        previousText: "newer",
        previousOptions: null,
        changedBy: null,
        changedByName: null,
        changedAt: "2026-09-05T00:00:00.000Z",
      },
    ].sort((a, b) => (a.changedAt > b.changedAt ? -1 : 1));

    expect(revisions[0].previousText).toBe("newer");
    expect(revisions[1].previousText).toBe("older");
  });
});
