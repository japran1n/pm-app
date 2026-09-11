// @vitest-environment jsdom
//
// F076 (missions/20260910-182104, AS-148): approving the brief makes its
// answers read-only in the client-facing questionnaire UI, not just at
// the RLS/action layer -- a client should see the input can't be edited,
// not just discover the save silently fails.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import * as briefActions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import type { BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeQuestion(overrides: Partial<BriefQuestion>): BriefQuestion {
  return {
    id: "q1",
    projectId: "p1",
    prompt: "What is your goal?",
    category: null,
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...overrides,
  };
}

describe("F076 AS-148: approved brief renders answers as read-only", () => {
  it("disables the answer input and shows a locked banner when briefState is approved", () => {
    const saveSpy = vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });
    const questions: BriefQuestion[] = [makeQuestion({ id: "q1" })];

    render(
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={[]}
        briefId="b1"
        briefState="approved"
      />,
    );

    expect(screen.getByTestId("questionnaire-approved-banner")).toBeInTheDocument();
    expect(screen.getByTestId("questionnaire-answer-stub")).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("does not show the locked banner or disable inputs while draft", () => {
    const questions: BriefQuestion[] = [makeQuestion({ id: "q1" })];

    render(
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={[]}
        briefId="b1"
        briefState="draft"
      />,
    );

    expect(screen.queryByTestId("questionnaire-approved-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("questionnaire-answer-stub")).not.toBeDisabled();
  });
});
