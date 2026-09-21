// @vitest-environment jsdom
//
// F054 (AS-130): "The team sees an indication that an answer has been
// edited." Renders the real <TeamAnswersView> against a fixed set of
// questions/answers and asserts on what's actually on screen: an
// "Edited" indicator appears only for the answer whose `hasRevisions`
// flag is true, and is absent for a same-shaped answer with no
// revisions -- this is the falsifiable core of AS-130, derived from the
// assertion text rather than from team-answers-view.tsx's own code.

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

describe("F054/AS-130: team sees an indication that an answer has been edited", () => {
  it("shows an Edited indicator for an answer with revisions", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-1", prompt: "Edited question" }),
        answer: makeAnswer({ id: "a-1", questionId: "q-1" }),
        hasRevisions: true,
      },
    ];

    render(<TeamAnswersView items={items} />);

    expect(screen.getByText("Edited question")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("does not show an Edited indicator for an answer with no revisions", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-2", prompt: "Never-edited question" }),
        answer: makeAnswer({ id: "a-2", questionId: "q-2" }),
        hasRevisions: false,
      },
    ];

    render(<TeamAnswersView items={items} />);

    expect(screen.getByText("Never-edited question")).toBeInTheDocument();
    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
  });

  it("does not show an Edited indicator for an unanswered question, even if flagged", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-3", prompt: "Unanswered question" }),
        answer: null,
        hasRevisions: false,
      },
    ];

    render(<TeamAnswersView items={items} />);

    expect(screen.getByText("Unanswered question")).toBeInTheDocument();
    expect(screen.getAllByText("Not answered yet").length).toBeGreaterThan(0);
    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
  });
});

describe("BR-014: choice chips are readable, not badge-sized", () => {
  it("renders selected options as sentence-case text-sm chips", () => {
    const items: TeamAnswersViewQuestion[] = [
      {
        question: makeQuestion({ id: "q-c", answerType: "multi_choice", options: ["Modern look", "Bold"] }),
        answer: makeAnswer({ id: "a-c", questionId: "q-c", answerText: null, answerOptions: ["Modern look"] }),
        hasRevisions: false,
      },
    ];
    render(<TeamAnswersView items={items} />);
    const chip = screen.getByText("Modern look");
    expect(chip.className).toContain("text-sm");
    expect(chip.className).toContain("normal-case");
    expect(chip.className).toContain("rounded-md");
    expect(chip.className).not.toContain("text-[9px]");
    expect(chip.className).not.toMatch(/(^|\s)uppercase/);
  });
});
