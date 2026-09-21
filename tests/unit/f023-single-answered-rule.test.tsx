// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/brief", () => ({
  saveBriefAnswer: vi.fn(),
  submitBrief: vi.fn().mockResolvedValue({ success: true }),
}));

import * as actions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import { TeamAnswersView } from "@/components/brief/team-answers-view";
import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function q(over: Partial<BriefQuestion>): BriefQuestion {
  return {
    id: "q1",
    projectId: "p",
    prompt: "Prompt",
    category: "A",
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...over,
  } as BriefQuestion;
}
function a(over: Partial<BriefAnswer>): BriefAnswer {
  return {
    id: "a",
    briefId: "b",
    questionId: "q1",
    questionPromptSnapshot: "Prompt",
    answerText: null,
    answerOptions: null,
    answeredBy: "u",
    answeredByName: "Sam",
    answeredAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    hasRevisions: false,
    ...over,
  } as BriefAnswer;
}

describe("BR-015/BR-044 one answered rule: portal resume", () => {
  const qs = [
    q({ id: "q1", category: "A", position: 0 }),
    q({ id: "q2", category: "B", position: 1, answerType: "single_choice", options: ["x", "y"] }),
  ];
  it("BR-015: whitespace-only text is unanswered, so resume lands on that section", () => {
    render(
      <PortalQuestionnaire
        questions={qs}
        initialAnswers={[a({ questionId: "q1", answerText: "   " })]}
        briefId="b"
      />,
    );
    expect(screen.getByTestId("questionnaire-section-title")).toHaveTextContent("A");
  });
  it("BR-016: multi-option single_choice counts as answered, resume skips it", () => {
    render(
      <PortalQuestionnaire
        questions={[q({ id: "q1", category: "A", answerType: "single_choice", options: ["x", "y"] }), qs[1]]}
        initialAnswers={[a({ questionId: "q1", answerOptions: ["x", "y"] })]}
        briefId="b"
      />,
    );
    expect(screen.getByTestId("questionnaire-section-title")).toHaveTextContent("B");
  });
});

describe("BR-015/BR-016/BR-044 team view", () => {
  it("BR-015: whitespace-only text renders Not answered, no value", () => {
    render(
      <TeamAnswersView
        items={[{ question: q({ required: true }), answer: a({ answerText: "  \n " }), hasRevisions: false }]}
      />,
    );
    expect(screen.getByText("Not answered")).toBeInTheDocument();
  });
  it("BR-016: multi-option single_choice shows chips", () => {
    render(
      <TeamAnswersView
        items={[
          {
            question: q({ answerType: "single_choice", options: ["x", "y"] }),
            answer: a({ answerOptions: ["x", "y"] }),
            hasRevisions: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("x")).toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
    expect(screen.queryByText(/Not answered/)).toBeNull();
  });
  it("BR-044: a row never shows chips and Not answered together", () => {
    const cases: Array<[BriefQuestion, BriefAnswer | null]> = [
      [q({ answerType: "multi_choice", options: ["x"] }), a({ answerOptions: [] })],
      [q({ answerType: "multi_choice", options: ["x"], required: true }), a({ answerOptions: ["x"] })],
      [q({ answerType: "single_choice", options: ["x"] }), a({ answerOptions: null })],
      [q({ answerType: "single_choice", options: ["x"] }), a({ answerOptions: ["x"] })],
    ];
    for (const [question, answer] of cases) {
      const { container, unmount } = render(
        <TeamAnswersView items={[{ question, answer, hasRevisions: false }]} />,
      );
      const chips = container.querySelectorAll("[class*='rounded-md']").length;
      const notAnswered = screen.queryAllByText(/Not answered/).length;
      expect(chips > 0 && notAnswered > 0).toBe(false);
      unmount();
    }
  });
});

describe("BR-042 retry of failed autosave", () => {
  const two = [
    q({ id: "q1", category: "A", position: 0, required: true }),
    q({ id: "q2", category: "B", position: 1 }),
  ];
  it("BR-042: failure, leave section, return, Retry re-sends without re-typing and enables Submit", async () => {
    const save = vi.mocked(actions.saveBriefAnswer);
    save.mockResolvedValue({ success: false, error: "db" } as never);
    render(<PortalQuestionnaire questions={two} initialAnswers={[]} briefId="b" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(save).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Previous"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next")); // review
    await waitFor(() => expect(screen.getByTestId("questionnaire-unsaved-warning")).toBeInTheDocument());
    expect(screen.getByTestId("questionnaire-submit-button")).toBeDisabled();

    save.mockClear();
    save.mockResolvedValue({ success: true } as never);
    fireEvent.click(screen.getByTestId("questionnaire-retry-button-review"));
    await waitFor(() => expect(screen.getByTestId("questionnaire-submit-button")).not.toBeDisabled());
    expect(save).toHaveBeenCalledWith("b", "q1", "hello", null);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
