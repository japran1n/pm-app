// @vitest-environment jsdom
//
// F013 (missions/20260921-brief-redesign): Next never hard-blocks, the review
// highlights missing required questions, Submit is the gate, and pending
// autosaves are flushed instead of lost.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import * as briefActions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import type { BriefQuestion } from "@/lib/queries/brief";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(briefActions, "saveBriefAnswer").mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function q(o: Partial<BriefQuestion>): BriefQuestion {
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
    ...o,
  };
}

const questions = [
  q({ id: "a", prompt: "Req A", required: true, position: 0 }),
  q({ id: "c", prompt: "Beta Q", category: "Beta", position: 1 }),
];

describe("F013 BR-041/BR-044: Next is non-blocking; review flags missing; Submit is the gate", () => {
  it("BR-041 BR-044 navigating with a required field empty reaches review, which highlights it and disables Submit", () => {
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("questionnaire-next-warning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Review your answers")).toBeInTheDocument();
    const missing = screen
      .getAllByTestId("review-question")
      .filter((el) => el.getAttribute("data-unanswered-required") === "true");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toHaveTextContent("Req A");
    expect(screen.getByTestId("review-missing-summary")).toBeInTheDocument();
    expect(screen.getByTestId("questionnaire-submit-button")).toBeDisabled();
  });

  it("BR-044 Submit is enabled once every required question is answered", () => {
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByTestId("review-missing-summary")).toBeNull();
    expect(screen.getByTestId("questionnaire-submit-button")).toBeEnabled();
  });
});

describe("F013 BR-042/BR-047: pending autosave is flushed", () => {
  it("BR-042 flushes the debounced save immediately on section change", async () => {
    const save = vi
      .spyOn(briefActions, "saveBriefAnswer")
      .mockResolvedValue({ success: true });
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "typed" },
    });
    expect(save).not.toHaveBeenCalled();
    // Navigate before the 800ms debounce elapses.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("b1", "a", "typed", null);
  });

  it("BR-042 flushes on unmount and does not double-save afterwards", async () => {
    const save = vi
      .spyOn(briefActions, "saveBriefAnswer")
      .mockResolvedValue({ success: true });
    const { unmount } = render(
      <PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />,
    );
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "typed" },
    });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("BR-047 Submit waits for the flushed save before calling submitBrief", async () => {
    const order: string[] = [];
    let resolveSave: (v: { success: true }) => void = () => {};
    vi.spyOn(briefActions, "saveBriefAnswer").mockImplementation(() => {
      order.push("save");
      return new Promise((r) => {
        resolveSave = r as typeof resolveSave;
      });
    });
    vi.spyOn(briefActions, "submitBrief").mockImplementation(async () => {
      order.push("submit");
      return { success: true } as never;
    });
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} briefId="b1" />);
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "typed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByTestId("questionnaire-submit-button"));
    await act(async () => {});
    expect(order).toEqual(["save"]);
    await act(async () => {
      resolveSave({ success: true });
    });
    expect(order).toEqual(["save", "submit"]);
  });
});
