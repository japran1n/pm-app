// @vitest-environment jsdom
//
// F066 (AS-130, AS-131): "The team sees an indication that an answer has
// been edited" / "The client sees an indication that an answer has been
// edited." Both assertions are exercised by rendering the real
// presentational components with a `hasRevisions` flag set/unset,
// asserting on what actually appears on screen -- not on how the flag
// gets computed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TeamAnswersView, type TeamAnswersViewQuestion } from "@/components/brief/team-answers-view";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
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

describe("F066/AS-130: team sees an Edited indicator for an edited answer", () => {
  it("shows an Edited badge when the answer has revisions", () => {
    const question = makeQuestion();
    const answer = makeAnswer({ hasRevisions: true });
    const items: TeamAnswersViewQuestion[] = [{ question, answer, hasRevisions: true }];

    render(<TeamAnswersView items={items} />);

    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("does not show an Edited badge when the answer has no revisions", () => {
    const question = makeQuestion();
    const answer = makeAnswer({ hasRevisions: false });
    const items: TeamAnswersViewQuestion[] = [{ question, answer, hasRevisions: false }];

    render(<TeamAnswersView items={items} />);

    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
  });
});

describe("F066/AS-131: client sees an indication that an answer has been edited", () => {
  it("shows an edited note when the current question's answer has revisions", () => {
    const question = makeQuestion();
    const answer = makeAnswer({ hasRevisions: true });

    render(<PortalQuestionnaire questions={[question]} initialAnswers={[answer]} />);

    expect(screen.getByTestId("questionnaire-edited-indicator")).toBeInTheDocument();
  });

  it("does not show an edited note when the current question's answer has no revisions", () => {
    const question = makeQuestion();
    const answer = makeAnswer({ hasRevisions: false });

    render(<PortalQuestionnaire questions={[question]} initialAnswers={[answer]} />);

    expect(screen.queryByTestId("questionnaire-edited-indicator")).not.toBeInTheDocument();
  });
});
