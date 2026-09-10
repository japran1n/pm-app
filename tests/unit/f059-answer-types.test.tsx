// @vitest-environment jsdom
//
// F059 (missions/20260910-182104, AS-119, AS-120, AS-121, AS-122): the
// four answer-type input widgets rendered by <AnswerInput>.
//
// AS-119: short_text renders a single-line text input.
// AS-120: long_text renders a multi-line textarea.
// AS-121: single_choice renders a radio group where exactly one option
// can be selected -- selecting a second option deselects the first.
// AS-122: multi_choice renders a checkbox group where more than one
// option can be checked at once.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { AnswerInput } from "@/components/brief/answer-input";
import type { BriefQuestion } from "@/lib/queries/brief";

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

describe("F059 AS-119: short_text accepts a single-line answer", () => {
  it("renders a single-line text input", () => {
    const question = makeQuestion({ answerType: "short_text" });
    render(
      <AnswerInput question={question} value="" selectedOptions={[]} onChange={() => {}} />,
    );

    const input = screen.getByTestId("questionnaire-answer-stub");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("type", "text");
  });

  it("calls onChange with the typed text and null options", () => {
    const question = makeQuestion({ answerType: "short_text" });
    let received: [string | null, string[] | null] | null = null;
    render(
      <AnswerInput
        question={question}
        value=""
        selectedOptions={[]}
        onChange={(text, options) => {
          received = [text, options];
        }}
      />,
    );

    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "Grow revenue" },
    });

    expect(received).toEqual(["Grow revenue", null]);
  });
});

describe("F059 AS-120: long_text accepts a multi-line answer", () => {
  it("renders a textarea", () => {
    const question = makeQuestion({ answerType: "long_text" });
    render(
      <AnswerInput question={question} value="" selectedOptions={[]} onChange={() => {}} />,
    );

    const textarea = screen.getByTestId("questionnaire-answer-stub");
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("accepts a multi-line value", () => {
    const question = makeQuestion({ answerType: "long_text" });
    let received: string | null = null;
    render(
      <AnswerInput
        question={question}
        value=""
        selectedOptions={[]}
        onChange={(text) => {
          received = text;
        }}
      />,
    );

    fireEvent.change(screen.getByTestId("questionnaire-answer-stub"), {
      target: { value: "Line one\nLine two\nLine three" },
    });

    expect(received).toBe("Line one\nLine two\nLine three");
  });
});

describe("F059 AS-121: single_choice accepts exactly one option", () => {
  const question = makeQuestion({
    id: "q2",
    answerType: "single_choice",
    options: ["Red", "Green", "Blue"],
  });

  it("renders a radio group with one option per choice", () => {
    render(
      <AnswerInput question={question} value={null} selectedOptions={[]} onChange={() => {}} />,
    );

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("selecting a different option replaces the previous selection", () => {
    let selected: string[] = [];
    function Wrapper() {
      return (
        <AnswerInput
          question={question}
          value={null}
          selectedOptions={selected}
          onChange={(_text, options) => {
            selected = options ?? [];
          }}
        />
      );
    }

    const { rerender } = render(<Wrapper />);

    fireEvent.click(screen.getByTestId("questionnaire-answer-option-Red"));
    expect(selected).toEqual(["Red"]);

    rerender(<Wrapper />);
    fireEvent.click(screen.getByTestId("questionnaire-answer-option-Blue"));
    expect(selected).toEqual(["Blue"]);
  });
});

describe("F059 AS-122: multi_choice accepts more than one option", () => {
  const question = makeQuestion({
    id: "q3",
    answerType: "multi_choice",
    options: ["Design", "Engineering", "Marketing"],
  });

  it("renders a checkbox per option", () => {
    render(
      <AnswerInput question={question} value={null} selectedOptions={[]} onChange={() => {}} />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
  });

  it("checking a second option keeps the first checked", () => {
    let selected: string[] = [];
    function Wrapper() {
      return (
        <AnswerInput
          question={question}
          value={null}
          selectedOptions={selected}
          onChange={(_text, options) => {
            selected = options ?? [];
          }}
        />
      );
    }

    const { rerender } = render(<Wrapper />);

    fireEvent.click(screen.getByTestId("questionnaire-answer-option-Design"));
    expect(selected).toEqual(["Design"]);

    rerender(<Wrapper />);
    fireEvent.click(screen.getByTestId("questionnaire-answer-option-Marketing"));
    expect(selected).toEqual(["Design", "Marketing"]);
  });
});
