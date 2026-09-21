// @vitest-environment jsdom
//
// F010 (missions/20260921-brief-redesign): portal review step.
// BR-043: last step shows all answers with a per-section "Edit" link.
// BR-044: unanswered required questions are highlighted; submit cannot bypass.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import * as briefActions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import { PortalBriefReview } from "@/components/brief/portal-brief-review";
import type { BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function q(overrides: Partial<BriefQuestion>): BriefQuestion {
  return {
    id: "q1",
    projectId: "p1",
    prompt: "Prompt",
    category: "Alpha",
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...overrides,
  };
}

const questions: BriefQuestion[] = [
  q({ id: "a", prompt: "Goal?", required: true, position: 0 }),
  q({ id: "b", prompt: "Colors?", category: "Beta", position: 1 }),
];

function goToReview() {
  fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
    target: { value: "Grow sales" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
    target: { value: "Blue" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("BR-043: review step lists all answers with per-section Edit", () => {
  it("BR-043 Next on the last section shows the review with unsaved values and Review progress", () => {
    render(
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={[]}
        briefId="b1"
      />,
    );
    goToReview();

    expect(screen.getByText("Review your answers")).toBeInTheDocument();
    expect(screen.getByTestId("questionnaire-progress-text")).toHaveTextContent(
      "Review",
    );
    expect(screen.getByText("Grow sales")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getAllByTestId("review-edit-button")).toHaveLength(2);
  });

  it("BR-043 Edit jumps back to that section and Next returns to the review", () => {
    render(
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={[]}
        briefId="b1"
      />,
    );
    goToReview();

    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    expect(screen.getByTestId("questionnaire-section-title")).toHaveTextContent(
      "Alpha",
    );
    expect(
      (screen.getByTestId("questionnaire-answer-stub") as HTMLInputElement)
        .value,
    ).toBe("Grow sales");
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "New goal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("New goal")).toBeInTheDocument();
  });

  it("BR-043 Submit is only on the review step", () => {
    render(
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={[]}
        briefId="b1"
      />,
    );
    expect(screen.queryByTestId("questionnaire-submit-button")).toBeNull();
    goToReview();
    expect(screen.getByTestId("questionnaire-submit-button")).toBeEnabled();
  });
});

describe("BR-044: unanswered required questions are highlighted and block submit", () => {
  it("BR-044 shows 'Not answered' only for required questions without an answer", () => {
    render(
      <PortalBriefReview
        sections={[
          {
            name: "Alpha",
            sectionIndex: 0,
            questions: [
              q({ id: "r", prompt: "Req", required: true }),
              q({ id: "o", prompt: "Opt", required: false }),
              q({ id: "d", prompt: "Done", required: true }),
            ],
            answers: new Map([
              ["d", { answerText: "yes", answerOptions: null }],
            ]),
          },
        ]}
        onEditSection={() => {}}
      />,
    );
    expect(screen.getAllByText("Not answered")).toHaveLength(1);
    const flagged = screen
      .getAllByTestId("review-question")
      .filter((el) => el.getAttribute("data-unanswered-required") === "true");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveTextContent("Req");
  });

  it("BR-044 renders selected options and calls onEditSection with the section index", () => {
    const onEdit = vi.fn();
    render(
      <PortalBriefReview
        sections={[
          {
            name: "Beta",
            sectionIndex: 3,
            questions: [
              q({
                id: "m",
                prompt: "Pick",
                answerType: "multi_choice",
                required: true,
              }),
            ],
            answers: new Map([
              ["m", { answerText: null, answerOptions: ["SEO", "Web"] }],
            ]),
          },
        ]}
        onEditSection={onEdit}
      />,
    );
    expect(screen.getByText("SEO, Web")).toBeInTheDocument();
    expect(screen.queryByText("Not answered")).toBeNull();
    fireEvent.click(screen.getByTestId("review-edit-button"));
    expect(onEdit).toHaveBeenCalledWith(3);
  });

  it("BR-044 clearing a required answer via Edit still reaches review, which highlights it, disables Submit, and submitBrief is never called", () => {
    const submitSpy = vi
      .spyOn(briefActions, "submitBrief")
      .mockResolvedValue({ success: true });
    render(
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={[]}
        briefId="b1"
      />,
    );
    goToReview();

    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Next does not block; walk on to the review step.
    while (!screen.queryByTestId("portal-brief-review")) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(
      screen
        .getAllByTestId("review-question")
        .some((el) => el.getAttribute("data-unanswered-required") === "true"),
    ).toBe(true);
    expect(screen.getByTestId("questionnaire-submit-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("questionnaire-submit-button"));
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
