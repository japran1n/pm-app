// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TeamAnswersView } from "@/components/brief/team-answers-view";
import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

afterEach(cleanup);

const q = (o: Partial<BriefQuestion> = {}): BriefQuestion => ({
  id: "q-1", projectId: "p", prompt: "Goal?", category: null, answerType: "short_text",
  helpText: null, required: true, options: null, position: 0, ...o,
});
const a = (o: Partial<BriefAnswer> = {}): BriefAnswer => ({
  id: "a-1", briefId: "b", questionId: "q-1", questionPromptSnapshot: "Goal?", answerText: "Ship",
  answerOptions: null, answeredBy: "u-1", answeredByName: "Ana", answeredAt: null,
  updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(), hasRevisions: false, ...o,
});

describe("F003", () => {
  it("test_BR_015_star_only_when_required_and_unanswered", () => {
    render(
      <TeamAnswersView
        items={[
          { question: q({ id: "q-1", prompt: "Answered req" }), answer: a(), hasRevisions: false },
          { question: q({ id: "q-2", prompt: "Open req" }), answer: null, hasRevisions: false },
          { question: q({ id: "q-3", prompt: "Open opt", required: false }), answer: null, hasRevisions: false },
        ]}
      />,
    );
    expect(screen.getAllByLabelText("required")).toHaveLength(1);
    expect(screen.getByText("Open req").querySelector("[aria-label='required']")).not.toBeNull();
  });

  it("test_BR_016_unanswered_required_shows_warning_not_answered", () => {
    render(<TeamAnswersView items={[{ question: q(), answer: null, hasRevisions: false }]} />);
    const el = screen.getByText("Not answered");
    expect(el.className).toContain("text-warning");
  });

  it("test_BR_017_answered_row_shows_name_and_relative_time_mono", () => {
    render(<TeamAnswersView items={[{ question: q(), answer: a(), hasRevisions: false }]} />);
    const el = screen.getByText("Ana · 2d ago");
    expect(el.className).toContain("font-mono");
  });
});
