// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/brief", () => ({
  saveBriefAnswer: vi.fn(),
  submitBrief: vi.fn(),
}));

import * as actions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import { PortalBriefReview } from "@/components/brief/portal-brief-review";
import type { BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const q = {
  id: "q1",
  sectionId: "s1",
  section: "Basics",
  prompt: "Name?",
  helpText: null,
  answerType: "short_text",
  options: null,
  required: true,
  sortOrder: 1,
} as unknown as BriefQuestion;

function renderFilled() {
  render(<PortalQuestionnaire questions={[q]} initialAnswers={[]} briefId="b1" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme" } });
}

describe("BR-047 submit cannot hang", () => {
  it("BR-047: a rejected submitBrief shows an error, re-enables the button, and a second click retries", async () => {
    vi.mocked(actions.saveBriefAnswer).mockResolvedValue({ success: true } as never);
    vi.mocked(actions.submitBrief)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ success: true } as never);
    renderFilled();
    fireEvent.click(screen.getByText("Next"));
    const btn = await screen.findByTestId("questionnaire-submit-button");
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-submit-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("questionnaire-submit-button")).toBeEnabled();
    expect(screen.getByTestId("questionnaire-submit-button")).toHaveTextContent("Submit");
    fireEvent.click(screen.getByTestId("questionnaire-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-submitted-message")).toBeInTheDocument(),
    );
    expect(actions.submitBrief).toHaveBeenCalledTimes(2);
  });
});

describe("BR-042 thrown autosave blocks submit; Retry re-attempts", () => {
  it("BR-042/BR-047: rejected save shows Couldn't save, blocks Submit; Retry re-sends the failed text and unblocks Submit", async () => {
    vi.mocked(actions.saveBriefAnswer)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ success: true } as never);
    renderFilled();
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-autosave-status")).toHaveTextContent(
        "Couldn't save",
      ),
    );
    const before = vi.mocked(actions.saveBriefAnswer).mock.calls.length;
    fireEvent.click(screen.getByTestId("questionnaire-retry-button"));
    await waitFor(() =>
      expect(vi.mocked(actions.saveBriefAnswer).mock.calls.length).toBeGreaterThan(before),
    );
    expect(vi.mocked(actions.saveBriefAnswer).mock.calls.at(-1)?.[2]).toBe("Acme");
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-autosave-status")).not.toHaveTextContent(
        "Couldn't save",
      ),
    );
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-submit-button")).toBeEnabled(),
    );
  });
});

describe("BR-044 review uses the shared answered rule", () => {
  it("BR-044: a whitespace-only required answer is highlighted as missing", () => {
    render(
      <PortalBriefReview
        sections={[
          {
            name: "Basics",
            sectionIndex: 0,
            questions: [q],
            answers: new Map([["q1", { answerText: "   ", answerOptions: null }]]),
          },
        ]}
        onEditSection={() => {}}
      />,
    );
    expect(screen.getByTestId("review-question")).toHaveAttribute(
      "data-unanswered-required",
      "true",
    );
  });
});
