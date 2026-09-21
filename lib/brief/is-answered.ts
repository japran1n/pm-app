// F012 (BR-015, BR-016, BR-021, BR-044): the ONE rule for "does this brief
// answer count as answered". Used by the team views, the brief page counters,
// the portal wizard and the portal review step so counts never disagree.
//   short_text / long_text : trimmed text is non-empty
//   single_choice          : at least one option selected
//   multi_choice           : at least one option selected
import type { BriefQuestion } from "@/lib/queries/brief";

export type AnswerValue = {
  answerText?: string | null;
  answerOptions?: string[] | null;
};

export function isBriefAnswerAnswered(
  question: Pick<BriefQuestion, "answerType">,
  answer: AnswerValue | null | undefined,
): boolean {
  if (!answer) return false;
  const optionCount = answer.answerOptions?.length ?? 0;
  switch (question.answerType) {
    // >=1, not ===1: legacy rows or a question whose answer_type was changed
    // from multi_choice can hold several options; that is still an answer.
    // The portal single-choice UI (radio group) only ever writes one option.
    case "single_choice":
      return optionCount >= 1;
    case "multi_choice":
      return optionCount >= 1;
    default:
      return (answer.answerText ?? "").trim() !== "";
  }
}
