// @vitest-environment jsdom
//
// F002 (BR-013, BR-014): the workspace team read view no longer shows
// per-question answer-type badges (Long text / Short text / Single choice /
// Multi choice), and choice option chips render their text exactly as
// stored instead of being visually uppercased.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TeamAnswersView, type TeamAnswersViewQuestion } from "@/components/brief/team-answers-view";
import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
});

function makeQuestion(overrides: Partial<BriefQuestion> = {}): BriefQuestion {
  return {
    id: "q-1",
    projectId: "p-1",
    prompt: "What is the project goal?",
    category: null,
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<BriefAnswer> = {}): BriefAnswer {
  return {
    id: "a-1",
    briefId: "b-1",
    questionId: "q-1",
    questionPromptSnapshot: "What is the project goal?",
    answerText: "Ship the thing.",
    answerOptions: null,
    answeredBy: "u-1",
    answeredAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    hasRevisions: false,
    ...overrides,
  };
}

describe("F002/BR-013: no answer type badges render in TeamAnswersView", () => {
  it("does not render type labels for short_text, long_text, single_choice, or multi_choice questions", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-1", prompt: "Short text question", answerType: "short_text" }),
        answer: makeAnswer({ id: "a-1", questionId: "q-1", answerText: "An answer" }),
        hasRevisions: false,
      },
      {
        question: makeQuestion({ id: "q-2", prompt: "Long text question", answerType: "long_text" }),
        answer: makeAnswer({ id: "a-2", questionId: "q-2", answerText: "A longer answer" }),
        hasRevisions: false,
      },
      {
        question: makeQuestion({ id: "q-3", prompt: "Single choice question", answerType: "single_choice" }),
        answer: makeAnswer({ id: "a-3", questionId: "q-3", answerText: null, answerOptions: ["Red"] }),
        hasRevisions: false,
      },
      {
        question: makeQuestion({ id: "q-4", prompt: "Multi choice question", answerType: "multi_choice" }),
        answer: makeAnswer({ id: "a-4", questionId: "q-4", answerText: null, answerOptions: ["Red", "Blue"] }),
        hasRevisions: false,
      },
    ];

    render(<TeamAnswersView items={items} />);

    for (const label of ["Short text", "Long text", "Single choice", "Multi choice"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("still renders the Edited badge alongside the (now badge-free) header", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-1", prompt: "Edited question" }),
        answer: makeAnswer({ id: "a-1", questionId: "q-1" }),
        hasRevisions: true,
      },
    ];

    render(<TeamAnswersView items={items} />);

    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.queryByText("Short text")).not.toBeInTheDocument();
  });
});

describe("F002/BR-014: choice chips render original case with no uppercase transform", () => {
  it("renders single/multi choice option text exactly as stored, without an uppercase CSS class", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-1", prompt: "Pick a color", answerType: "multi_choice" }),
        answer: makeAnswer({
          id: "a-1",
          questionId: "q-1",
          answerText: null,
          answerOptions: ["Deep Blue", "warm Orange"],
        }),
        hasRevisions: false,
      },
    ];

    render(<TeamAnswersView items={items} />);

    const deepBlueChip = screen.getByText("Deep Blue");
    const warmOrangeChip = screen.getByText("warm Orange");

    expect(deepBlueChip).toBeInTheDocument();
    expect(warmOrangeChip).toBeInTheDocument();
    expect(deepBlueChip.className).not.toMatch(/\buppercase\b/);
    expect(warmOrangeChip.className).not.toMatch(/\buppercase\b/);
  });
});
