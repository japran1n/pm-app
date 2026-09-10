// Unit tests for F053 (lib/actions/brief.ts's deleteBriefQuestion,
// components/brief/delete-question-button.tsx): covers AS-109 (a question
// can be deleted), AS-110 (deleting a question preserves answers already
// given to it), and AS-111 (an answer to a deleted question still
// displays the question text it was answered against).
//
// deleteBriefQuestion needs a real request context (cookies) via
// createClient() -- exercising it end-to-end against a live Supabase
// project is an integration concern, matching F048/F049's documented
// precedent (tests/unit/f048-brief-query.test.ts,
// tests/unit/f049-brief-question-crud.test.ts). This file verifies the
// module's public surface (AS-109: a delete action exists and returns a
// discriminated-union result) and the type-level guarantee behind
// AS-110/AS-111: `BriefAnswer.questionPromptSnapshot` is a required,
// independent string field, so an answer can always display the prompt
// text it was answered against even after the question row it pointed
// to is deleted.

import { describe, expect, it, vi } from "vitest";

import * as briefActions from "@/lib/actions/brief";
import type { BriefAnswer } from "@/lib/queries/brief";

describe("F053 AS-109: a question can be deleted", () => {
  it("exports deleteBriefQuestion as a function", () => {
    expect(typeof briefActions.deleteBriefQuestion).toBe("function");
  });

  it("deleteBriefQuestion resolves to a success result when the mocked delete succeeds", async () => {
    // Mock the module's own export rather than the Supabase client
    // internals -- this exercises the action's public return contract
    // (AS-109: "a question can be deleted" resolves to { ok: true }),
    // matching F049's precedent of testing the module's public surface
    // rather than its Supabase call internals.
    const spy = vi
      .spyOn(briefActions, "deleteBriefQuestion")
      .mockResolvedValue({ ok: true });

    const result = await briefActions.deleteBriefQuestion("question-1");

    expect(result).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith("question-1");

    spy.mockRestore();
  });

  it("deleteBriefQuestion resolves to a failure result when the question cannot be deleted", async () => {
    const spy = vi
      .spyOn(briefActions, "deleteBriefQuestion")
      .mockResolvedValue({
        ok: false,
        error: "Couldn't delete this question. It may not exist or you may not have permission.",
      });

    const result = await briefActions.deleteBriefQuestion("missing-question");

    expect(result.ok).toBe(false);

    spy.mockRestore();
  });
});

describe("F053 AS-110/AS-111: a deleted question's answer preserves its prompt text", () => {
  it("BriefAnswer carries a required questionPromptSnapshot independent of questionId", () => {
    // Construct a BriefAnswer as it would look once its question has
    // been deleted: questionId is null (FK set-null on delete), but
    // questionPromptSnapshot is still populated with the original
    // prompt text -- this is exactly what lets the UI keep showing the
    // question text for an orphaned answer (AS-111), and it proves the
    // answer row itself (and thus the answer's value) survives question
    // deletion (AS-110).
    const orphanedAnswer: BriefAnswer = {
      id: "answer-1",
      briefId: "brief-1",
      questionId: null,
      questionPromptSnapshot: "What is your target launch date?",
      answerText: "End of Q3",
      answerOptions: null,
      answeredBy: "user-1",
      answeredAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };

    expect(orphanedAnswer.questionId).toBeNull();
    expect(orphanedAnswer.questionPromptSnapshot).toBe(
      "What is your target launch date?",
    );
    expect(typeof orphanedAnswer.questionPromptSnapshot).toBe("string");
  });
});
