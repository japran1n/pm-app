// @vitest-environment jsdom
//
// Unit tests for F051 (components/brief/choice-options-editor.tsx):
// covers AS-106 (a choice question carries its selectable options).
// Tests derive from the assertion text -- a choice question must be able
// to carry a list of selectable options that a user can add to, edit,
// and remove from -- not from the specific implementation.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { ChoiceOptionsEditor } from "@/components/brief/choice-options-editor";
import { createQuestionSchema } from "@/lib/validation/brief";

afterEach(() => {
  cleanup();
});

describe("AS-106: a choice question carries its selectable options", () => {
  it("renders one input per existing option", () => {
    render(<ChoiceOptionsEditor options={["Red", "Blue"]} onChange={() => {}} />);
    expect(screen.getByDisplayValue("Red")).toBeTruthy();
    expect(screen.getByDisplayValue("Blue")).toBeTruthy();
  });

  it("adds a new empty option when 'Add option' is clicked", () => {
    const onChange = vi.fn();
    render(<ChoiceOptionsEditor options={["Red"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add option/i }));
    expect(onChange).toHaveBeenCalledWith(["Red", ""]);
  });

  it("removes an option when its remove button is clicked", () => {
    const onChange = vi.fn();
    render(<ChoiceOptionsEditor options={["Red", "Blue"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove option 1/i }));
    expect(onChange).toHaveBeenCalledWith(["Blue"]);
  });

  it("updates an option's text when its input changes", () => {
    const onChange = vi.fn();
    render(<ChoiceOptionsEditor options={["Red"]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("Red"), { target: { value: "Green" } });
    expect(onChange).toHaveBeenCalledWith(["Green"]);
  });

  it("the resulting options array validates against createQuestionSchema for a choice question", () => {
    const result = createQuestionSchema.safeParse({
      prompt: "Pick a colour",
      category: "Design",
      answerType: "single_choice",
      options: ["Red", "Blue", "Green"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toEqual(["Red", "Blue", "Green"]);
    }
  });
});
