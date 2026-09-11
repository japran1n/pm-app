// @vitest-environment jsdom
//
// F058 (missions/20260910-182104, AS-117): a client returning to the
// questionnaire resumes at the first unanswered question rather than
// always starting at index 0.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import * as briefActions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeQuestion(overrides: Partial<BriefQuestion>): BriefQuestion {
  return {
    id: "q1",
    projectId: "p1",
    prompt: "Untitled question",
    category: null,
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<BriefAnswer>): BriefAnswer {
  return {
    id: "a1",
    briefId: "brief-1",
    questionId: "q1",
    questionPromptSnapshot: "snapshot",
    answerText: null,
    answerOptions: null,
    answeredBy: null,
    answeredAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasRevisions: false,
    ...overrides,
  };
}

describe("F058 AS-117: resumes at first unanswered question", () => {
  it("starts at the first question with no matching answer", () => {
    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", prompt: "Question one" }),
      makeQuestion({ id: "q2", prompt: "Question two" }),
      makeQuestion({ id: "q3", prompt: "Question three" }),
    ];
    const answers: BriefAnswer[] = [
      makeAnswer({ id: "a1", questionId: "q1", answerText: "answered" }),
    ];

    render(
      <PortalQuestionnaire questions={questions} initialAnswers={answers} briefId="brief-1" />,
    );

    expect(screen.getByText("Question two")).toBeInTheDocument();
  });

  it("starts at index 0 when no questions are answered", () => {
    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", prompt: "Question one" }),
      makeQuestion({ id: "q2", prompt: "Question two" }),
    ];

    render(
      <PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="brief-1" />,
    );

    expect(screen.getByText("Question one")).toBeInTheDocument();
  });

  it("starts at the last question when all questions are answered", () => {
    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", prompt: "Question one" }),
      makeQuestion({ id: "q2", prompt: "Question two" }),
    ];
    const answers: BriefAnswer[] = [
      makeAnswer({ id: "a1", questionId: "q1", answerText: "answered one" }),
      makeAnswer({ id: "a2", questionId: "q2", answerText: "answered two" }),
    ];

    render(
      <PortalQuestionnaire questions={questions} initialAnswers={answers} briefId="brief-1" />,
    );

    expect(screen.getByText("Question two")).toBeInTheDocument();
  });

  it("treats a question with only selected options (no text) as answered", () => {
    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", prompt: "Question one", answerType: "single_choice" }),
      makeQuestion({ id: "q2", prompt: "Question two" }),
    ];
    const answers: BriefAnswer[] = [
      makeAnswer({ id: "a1", questionId: "q1", answerText: null, answerOptions: ["Option A"] }),
    ];

    render(
      <PortalQuestionnaire questions={questions} initialAnswers={answers} briefId="brief-1" />,
    );

    expect(screen.getByText("Question two")).toBeInTheDocument();
  });

  it("treats an empty-string answer as unanswered", () => {
    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", prompt: "Question one" }),
      makeQuestion({ id: "q2", prompt: "Question two" }),
    ];
    const answers: BriefAnswer[] = [
      makeAnswer({ id: "a1", questionId: "q1", answerText: "" }),
    ];

    render(
      <PortalQuestionnaire questions={questions} initialAnswers={answers} briefId="brief-1" />,
    );

    expect(screen.getByText("Question one")).toBeInTheDocument();
  });
});
