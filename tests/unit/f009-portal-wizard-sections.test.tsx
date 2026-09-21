// @vitest-environment jsdom
//
// F009 (missions/20260921-brief-redesign): section-per-step portal wizard.
// BR-042, BR-045, BR-046, BR-047 plus multi-question required gating (BR-041).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import * as briefActions from "@/lib/actions/brief";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import type { BriefQuestion } from "@/lib/queries/brief";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

const twoSections: BriefQuestion[] = [
  q({ id: "a", prompt: "Req A", required: true, position: 0 }),
  q({ id: "b", prompt: "Opt B", position: 1 }),
  q({ id: "c", prompt: "Next section Q", category: "Beta", position: 2 }),
];

describe("F009 BR-041: Next is blocked only by unanswered required questions in the section", () => {
  it("BR-041 blocks with a required error while a required question is empty, even if optional is answered", () => {
    render(<PortalQuestionnaire questions={twoSections} initialAnswers={[]} />);
    fireEvent.change(screen.getAllByTestId("questionnaire-answer-stub")[1], {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByTestId("questionnaire-required-error")).toHaveLength(1);
    expect(screen.queryByText("Next section Q")).toBeNull();
  });

  it("BR-041 proceeds once the required question is answered, leaving the optional one empty", () => {
    render(<PortalQuestionnaire questions={twoSections} initialAnswers={[]} />);
    fireEvent.change(screen.getAllByTestId("questionnaire-answer-stub")[0], {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Next section Q")).toBeInTheDocument();
  });
});

describe("F009 BR-042 / BR-047: per-question autosave with aggregated indicator", () => {
  it("BR-042 BR-047 saves each edited question via saveBriefAnswer within 1s and shows Saving then Saved", async () => {
    let resolve!: () => void;
    const spy = vi.spyOn(briefActions, "saveBriefAnswer").mockImplementation(
      () => new Promise((r) => (resolve = () => r({ success: true }))),
    );
    render(<PortalQuestionnaire questions={twoSections} initialAnswers={[]} briefId="brief-1" />);

    const inputs = screen.getAllByTestId("questionnaire-answer-stub");
    fireEvent.change(inputs[1], { target: { value: "hello" } });
    expect(spy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("brief-1", "b", "hello", null);
    expect(screen.getByTestId("questionnaire-autosave-status")).toHaveTextContent("Saving…");

    await act(async () => {
      resolve();
    });
    expect(screen.getByTestId("questionnaire-autosave-status")).toHaveTextContent("Saved");

    fireEvent.change(inputs[0], { target: { value: "world" } });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(spy).toHaveBeenCalledWith("brief-1", "a", "world", null);
  });
});

describe("F009 BR-045: help text visible", () => {
  it("BR-045 renders helpText for each question in the section", () => {
    render(
      <PortalQuestionnaire
        questions={[
          q({ id: "a", helpText: "Explain it briefly", position: 0 }),
          q({ id: "b", helpText: "Second hint", position: 1 }),
        ]}
        initialAnswers={[]}
      />,
    );
    expect(screen.getByText("Explain it briefly")).toBeVisible();
    expect(screen.getByText("Second hint")).toBeVisible();
  });
});

describe("F009 BR-046: choice options are not uppercased", () => {
  it("BR-046 option labels carry normal-case and keep their original text", () => {
    render(
      <PortalQuestionnaire
        questions={[
          q({ id: "a", answerType: "single_choice", options: ["Small budget", "Large Budget"] }),
          q({ id: "b", answerType: "multi_choice", options: ["Web design", "SEO"], position: 1 }),
        ]}
        initialAnswers={[]}
      />,
    );
    for (const text of ["Small budget", "Large Budget", "Web design", "SEO"]) {
      const label = screen.getByText(text);
      expect(label).toHaveClass("normal-case");
      expect(label.className).not.toMatch(/(^|\s)uppercase(\s|$)/);
    }
  });
});
