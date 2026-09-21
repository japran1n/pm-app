// @vitest-environment jsdom
//
// F061 (missions/20260910-182104, AS-124/AS-125/AS-126): submitting the
// brief questionnaire.
//
// AS-124: A client can submit the questionnaire.
// AS-125: Submitting sets the brief state to submitted.
// AS-126: Submitting does not prevent further edits to answers.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("F061: Submit button is rendered", () => {
  it("shows a Submit button on the questionnaire", () => {
    const questions: BriefQuestion[] = [makeQuestion({ id: "q1", required: false })];
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    // F010: Submit lives on the review step, reached via Next from the last section.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByTestId("questionnaire-submit-button")).toBeInTheDocument();
  });
});

describe("F061 AS-124/AS-125: submitting calls submitBrief and shows success", () => {
  it("calls submitBrief with the brief id and shows the submitted message", async () => {
    vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });
    const submitSpy = vi
      .spyOn(briefActions, "submitBrief")
      .mockResolvedValue({ success: true });

    const questions: BriefQuestion[] = [makeQuestion({ id: "q1", required: false })];
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByTestId("questionnaire-submit-button"));

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith("b1");
    });

    expect(
      await screen.findByTestId("questionnaire-submitted-message"),
    ).toHaveTextContent("Brief submitted. You can still edit your answers.");
  });
});

describe("F061 AS-124: submit blocked until required questions are answered", () => {
  it("does not reach the review/submit step and never calls submitBrief while a required question is unanswered", () => {
    const submitSpy = vi.spyOn(briefActions, "submitBrief").mockResolvedValue({ success: true });

    const questions: BriefQuestion[] = [
      makeQuestion({ id: "q1", required: true }),
      makeQuestion({ id: "q2", prompt: "Second question", required: false }),
    ];

    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByTestId("questionnaire-required-error")).toBeInTheDocument();
    expect(screen.queryByTestId("questionnaire-submit-button")).toBeNull();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});

describe("F061 AS-126: the form stays editable after a successful submit", () => {
  it("keeps the answer input enabled and editable once submitted is shown", async () => {
    vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });
    vi.spyOn(briefActions, "submitBrief").mockResolvedValue({ success: true });

    const questions: BriefQuestion[] = [makeQuestion({ id: "q1", required: false })];
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByTestId("questionnaire-submit-button"));

    await screen.findByTestId("questionnaire-submitted-message");
    // F010: answers are edited via the review step's Edit button.
    fireEvent.click(screen.getByTestId("review-edit-button"));

    const input = screen.getByTestId("questionnaire-answer-stub");
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: "Edited after submit" } });
    expect((input as HTMLInputElement | HTMLTextAreaElement).value).toBe("Edited after submit");

    // Returning to the review, the submitted message stays and the edit shows.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Edited after submit")).toBeInTheDocument();
    expect(screen.getByTestId("questionnaire-submitted-message")).toBeInTheDocument();
  });
});
