// @vitest-environment jsdom
//
// F055 (missions/20260910-182104, AS-113, AS-114): real-DOM render tests
// for <PortalQuestionnaire> -- the client-facing brief questionnaire.
//
// AS-113 ("a client of a portal-enabled project can open the
// questionnaire") is exercised at the component level here: given a
// well-formed list of questions the component renders without throwing,
// which is the piece of AS-113 that lives in this file (the route-level
// access guard itself is inherited from the existing project layout --
// see app/(portal)/portal/[workspaceSlug]/p/[projectId]/brief/page.tsx's
// own comment -- and isn't re-tested here).
//
// AS-114 ("the questionnaire presents one question at a time") is the
// core behaviour under test: only the current question's prompt is in
// the DOM at any time, Previous/Next move `currentIndex`, and the
// boundary buttons disable at the first/last question rather than
// wrapping.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

// Explicit cleanup after each test -- this repo's vitest config doesn't
// enable jest-style `globals`, so @testing-library/react's own
// afterEach-based auto-cleanup never registers (see
// tests/unit/user-avatar.test.tsx's own comment on this).
afterEach(() => {
  cleanup();
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

describe("F055: AS-113 a client can open the questionnaire", () => {
  it("renders without throwing given a list of questions", () => {
    const questions: BriefQuestion[] = [makeQuestion({ id: "q1", prompt: "Goal?" })];
    const answers: BriefAnswer[] = [];

    render(<PortalQuestionnaire questions={questions} initialAnswers={answers} />);

    expect(screen.getByTestId("portal-questionnaire")).toBeTruthy();
    expect(screen.getByText("Goal?")).toBeTruthy();
  });
});

describe("F055: AS-114 / BR-040 the questionnaire presents one section per step", () => {
  const questions: BriefQuestion[] = [
    makeQuestion({ id: "q1", prompt: "First question?", category: "Alpha", position: 0 }),
    makeQuestion({ id: "q1b", prompt: "First-b question?", category: "Alpha", position: 1 }),
    makeQuestion({
      id: "q2",
      prompt: "Second question?",
      category: "Beta",
      position: 2,
      required: true,
    }),
    makeQuestion({ id: "q3", prompt: "Third question?", category: "Gamma", position: 3 }),
  ];

  it("BR-040: shows all questions of the first section and no others, with Step 1 of 3", () => {
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} />);

    expect(screen.getByText("First question?")).toBeTruthy();
    expect(screen.getByText("First-b question?")).toBeTruthy();
    expect(screen.queryByText("Second question?")).toBeNull();
    expect(screen.queryByText("Third question?")).toBeNull();
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    expect(screen.getByTestId("questionnaire-section-title")).toHaveTextContent("Alpha");
  });

  it("BR-041: Previous is disabled on the first section", () => {
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("BR-041: Next advances to the next section without blocking on optional questions", () => {
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Second question?")).toBeTruthy();
    expect(screen.queryByText("First question?")).toBeNull();
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    expect(screen.getByTestId("questionnaire-required-badge")).toBeTruthy();
  });

  it("BR-041: Next is disabled on the last section and Previous returns to prior sections", () => {
    render(<PortalQuestionnaire questions={questions} initialAnswers={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "An answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Third question?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Second question?")).toBeTruthy();
  });

  it("pre-fills the answer stub from initialAnswers when one exists for the current question", () => {
    // F058 (AS-117) makes the initial `currentIndex` resume at the first
    // *unanswered* question, so this test uses its own single-question
    // list to keep asserting the prefill behaviour independent of that
    // resume logic (which is covered separately in
    // tests/unit/f058-resume-first-unanswered.test.tsx).
    const singleQuestion: BriefQuestion[] = [
      makeQuestion({ id: "q1", prompt: "First question?", position: 0 }),
    ];
    const answers: BriefAnswer[] = [
      {
        id: "a1",
        briefId: "b1",
        questionId: "q1",
        questionPromptSnapshot: "First question?",
        answerText: "My existing answer",
        answerOptions: null,
        answeredBy: "user-1",
        answeredAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        hasRevisions: false,
      },
    ];

    render(<PortalQuestionnaire questions={singleQuestion} initialAnswers={answers} />);

    expect(screen.getByTestId("questionnaire-answer-stub")).toHaveValue("My existing answer");
  });
});
