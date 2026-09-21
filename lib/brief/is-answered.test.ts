import { describe, expect, it } from "vitest";

import { isBriefAnswerAnswered } from "@/lib/brief/is-answered";
import { isAnswered } from "@/components/brief/portal-questionnaire";
import type { BriefQuestion } from "@/lib/queries/brief";

const q = (answerType: string) => ({ answerType }) as BriefQuestion;

describe("isBriefAnswerAnswered (BR-015, BR-016, BR-021, BR-044)", () => {
  it("BR-015: null answer is unanswered", () => {
    expect(isBriefAnswerAnswered(q("short_text"), null)).toBe(false);
  });
  it("BR-015: whitespace-only text is unanswered for short and long text", () => {
    for (const t of ["short_text", "long_text"]) {
      expect(isBriefAnswerAnswered(q(t), { answerText: "  \n\t " })).toBe(false);
      expect(isBriefAnswerAnswered(q(t), { answerText: "" })).toBe(false);
      expect(isBriefAnswerAnswered(q(t), { answerText: null })).toBe(false);
      expect(isBriefAnswerAnswered(q(t), { answerText: " hi " })).toBe(true);
    }
  });
  it("BR-016: single_choice needs at least one option (legacy multi-option rows count)", () => {
    expect(isBriefAnswerAnswered(q("single_choice"), { answerOptions: [] })).toBe(false);
    expect(isBriefAnswerAnswered(q("single_choice"), { answerOptions: ["a"] })).toBe(true);
    expect(isBriefAnswerAnswered(q("single_choice"), { answerOptions: ["a", "b"] })).toBe(true);
  });
  it("BR-016: multi_choice needs at least one option; text is ignored", () => {
    expect(isBriefAnswerAnswered(q("multi_choice"), { answerOptions: null })).toBe(false);
    expect(isBriefAnswerAnswered(q("multi_choice"), { answerOptions: ["a", "b"] })).toBe(true);
    expect(isBriefAnswerAnswered(q("multi_choice"), { answerText: "x", answerOptions: [] })).toBe(false);
  });
  it("BR-044: portal isAnswered agrees with the shared rule", () => {
    const cases: [string, string | null, string[] | null][] = [
      ["short_text", "   ", null],
      ["long_text", "ok", null],
      ["single_choice", null, ["a", "b"]],
      ["single_choice", null, []],
      ["multi_choice", null, ["a"]],
    ];
    for (const [t, text, options] of cases) {
      expect(isAnswered(q(t), { text, options })).toBe(
        isBriefAnswerAnswered(q(t), { answerText: text, answerOptions: options }),
      );
    }
  });
});
