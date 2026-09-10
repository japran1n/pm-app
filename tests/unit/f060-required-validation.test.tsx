// @vitest-environment jsdom
//
// F060 (missions/20260910-182104, AS-123): a required question must be
// answered before the brief can advance past it via Next.
//
// AS-123: A required question must be answered before the brief can be
// submitted. Since the questionnaire advances one question at a time
// (F055, AS-114), the enforcement point is the Next button: pressing it
// on an unanswered required question must not advance currentIndex and
// must show an inline error. Non-required questions must not block Next
// when unanswered.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("F060 AS-123: required question blocks Next when unanswered", () => {
  it("does not advance and shows an error when the required question has no answer", () => {
    vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });

    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", required: true }),
      makeQuestion({ id: "q2", prompt: "Second question", required: false }),
    ];
    const answers: BriefAnswer[] = [];

    render(<PortalQuestionnaire questions={questions} initialAnswers={answers} />);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByTestId("questionnaire-required-error")).toHaveTextContent(
      "This question is required",
    );
    expect(screen.getByRole("heading", { name: "What is your goal?" })).toBeInTheDocument();
  });
});

describe("F060: optional question allows Next when unanswered", () => {
  it("advances to the next question with no error", () => {
    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", required: false }),
      makeQuestion({ id: "q2", prompt: "Second question", required: false }),
    ];
    const answers: BriefAnswer[] = [];

    render(<PortalQuestionnaire questions={questions} initialAnswers={answers} />);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.queryByTestId("questionnaire-required-error")).toBeNull();
    expect(screen.getByRole("heading", { name: "Second question" })).toBeInTheDocument();
  });
});

describe("F060 AS-123: required question allows Next once answered", () => {
  it("advances once text has been entered for a required short_text question", () => {
    vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });

    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", required: true }),
      makeQuestion({ id: "q2", prompt: "Second question", required: false }),
    ];
    const answers: BriefAnswer[] = [];

    render(<PortalQuestionnaire questions={questions} initialAnswers={answers} />);

    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "Grow revenue" },
    });

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.queryByTestId("questionnaire-required-error")).toBeNull();
    expect(screen.getByRole("heading", { name: "Second question" })).toBeInTheDocument();
  });

  it("advances a required single_choice question once one option is selected", () => {
    vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });

    const questions: BriefQuestion[] = [
      makeQuestion({
        id: "q1",
        required: true,
        answerType: "single_choice",
        options: ["A", "B"],
      }),
      makeQuestion({ id: "q2", prompt: "Second question", required: false }),
    ];
    const answers: BriefAnswer[] = [];

    render(<PortalQuestionnaire questions={questions} initialAnswers={answers} />);

    fireEvent.click(screen.getByRole("radio", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.queryByTestId("questionnaire-required-error")).toBeNull();
    expect(screen.getByRole("heading", { name: "Second question" })).toBeInTheDocument();
  });
});
