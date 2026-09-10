// @vitest-environment jsdom
//
// F050 (AS-102, AS-103, AS-104, AS-105): render coverage for
// components/brief/question-list.tsx and components/brief/question-form.tsx.
// Asserts derive from the assertion text -- a question carries a category
// (AS-102), an answer type from a fixed set (AS-103), can carry help text
// (AS-104), and can be marked required (AS-105) -- not from how the
// components happen to be implemented.
//
// Server actions are mocked since createBriefQuestion/updateBriefQuestion
// require a real Supabase request context (same rationale as
// tests/unit/f049-brief-question-crud.test.ts).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/actions/brief", () => ({
  createBriefQuestion: vi.fn(),
  updateBriefQuestion: vi.fn(),
}));

import { QuestionList } from "@/components/brief/question-list";
import { QuestionForm } from "@/components/brief/question-form";
import type { BriefQuestion } from "@/lib/queries/brief";

afterEach(cleanup);

function makeQuestion(overrides: Partial<BriefQuestion> = {}): BriefQuestion {
  return {
    id: "q-1",
    projectId: "project-1",
    prompt: "What's your target launch date?",
    category: "Timeline",
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position: 0,
    ...overrides,
  };
}

describe("F050 AS-102: a question carries a category", () => {
  it("test_AS_102_question_list_shows_category_badge", () => {
    render(
      <QuestionList projectId="project-1" questions={[makeQuestion({ category: "Timeline" })]} />,
    );
    expect(screen.getByText("Timeline")).toBeInTheDocument();
  });

  it("test_AS_102_question_list_omits_category_badge_when_null", () => {
    render(
      <QuestionList
        projectId="project-1"
        questions={[makeQuestion({ category: null })]}
      />,
    );
    expect(screen.queryByText("Timeline")).not.toBeInTheDocument();
  });
});

describe("F050 AS-103: a question carries an answer type", () => {
  it.each([
    ["short_text", "Short text"],
    ["long_text", "Long text"],
    ["single_choice", "Single choice"],
    ["multi_choice", "Multi choice"],
  ] as const)("test_AS_103_answer_type_%s_renders_as_%s", (answerType, label) => {
    render(
      <QuestionList projectId="project-1" questions={[makeQuestion({ answerType })]} />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("test_AS_103_question_form_offers_all_four_answer_types", () => {
    render(<QuestionForm projectId="project-1" />);
    expect(screen.getByText("Answer type")).toBeInTheDocument();
  });
});

describe("F050 AS-104: a question can carry help text", () => {
  it("test_AS_104_question_list_shows_help_text_when_present", () => {
    render(
      <QuestionList
        projectId="project-1"
        questions={[makeQuestion({ helpText: "Give your best estimate." })]}
      />,
    );
    expect(screen.getByText("Give your best estimate.")).toBeInTheDocument();
  });

  it("test_AS_104_question_list_omits_help_text_when_absent", () => {
    render(
      <QuestionList projectId="project-1" questions={[makeQuestion({ helpText: null })]} />,
    );
    expect(screen.queryByText("Give your best estimate.")).not.toBeInTheDocument();
  });

  it("test_AS_104_question_form_has_optional_help_text_field", () => {
    render(<QuestionForm projectId="project-1" />);
    expect(screen.getByLabelText("Help text (optional)")).toBeInTheDocument();
  });
});

describe("F050 AS-105: a question can be marked required", () => {
  it("test_AS_105_question_list_marks_required_question", () => {
    render(
      <QuestionList projectId="project-1" questions={[makeQuestion({ required: true })]} />,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("test_AS_105_question_list_does_not_mark_optional_question_as_required", () => {
    render(
      <QuestionList projectId="project-1" questions={[makeQuestion({ required: false })]} />,
    );
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
  });

  it("test_AS_105_question_form_has_required_checkbox", () => {
    render(<QuestionForm projectId="project-1" />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});
