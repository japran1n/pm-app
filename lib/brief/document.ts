// F071: brief document content builder (AS-139, AS-140, AS-141).
//
// Mission 20260910-182104, milestone M9 (Brief: document and approval).
//
// Pure function, deliberately separated from lib/actions/brief.ts so it
// can be unit-tested without a live Supabase client (same split
// tests/unit/f049-brief-question-crud.test.ts's header comment documents
// for schema validation vs. DB-touching actions). No AI is involved
// (standing-decisions.md #11) -- this is a fixed four-section template
// that quotes each question's prompt and the client's answer beneath it,
// nothing more.
//
// Section order and headings are fixed per standing-decisions.md #11 /
// this feature's spec (AS-140): Project Overview, Goals & Objectives,
// Target Audience, Technical Requirements, mapped from
// brief_questions.category values 'overview' | 'goals' | 'audience' |
// 'technical'. A question whose category doesn't match any of the four
// (or is null) is simply not shown in any section -- the four sections
// are fixed, not dynamic, per AS-140.

import type { BriefAnswer, BriefQuestion } from "@/lib/queries/brief";

export const BRIEF_DOCUMENT_SECTIONS: { category: string; heading: string }[] = [
  { category: "overview", heading: "Project Overview" },
  { category: "goals", heading: "Goals & Objectives" },
  { category: "audience", heading: "Target Audience" },
  { category: "technical", heading: "Technical Requirements" },
];

// Renders one answer's displayable text -- multi/single choice answers
// store their selection(s) in `answerOptions` (text[]), free-text answers
// in `answerText`. Falls back to a plain placeholder when a question has
// no answer at all, so a section is never silently missing a question.
function formatAnswer(answer: BriefAnswer | undefined): string {
  if (!answer) {
    return "_No answer yet._";
  }
  if (answer.answerOptions && answer.answerOptions.length > 0) {
    return answer.answerOptions.join(", ");
  }
  if (answer.answerText && answer.answerText.trim() !== "") {
    return answer.answerText;
  }
  return "_No answer yet._";
}

export function buildBriefDocumentContent(
  questions: BriefQuestion[],
  answers: BriefAnswer[],
): string {
  const answersByQuestionId = new Map(
    answers.filter((answer) => answer.questionId).map((answer) => [answer.questionId, answer]),
  );

  const sections = BRIEF_DOCUMENT_SECTIONS.map(({ category, heading }) => {
    const sectionQuestions = questions
      .filter((question) => question.category === category)
      .sort((a, b) => a.position - b.position);

    if (sectionQuestions.length === 0) {
      return `## ${heading}\n\nNo questions added.`;
    }

    const body = sectionQuestions
      .map((question) => {
        const answer = answersByQuestionId.get(question.id);
        return `**${question.prompt}**\n\n${formatAnswer(answer)}`;
      })
      .join("\n\n");

    return `## ${heading}\n\n${body}`;
  });

  return sections.join("\n\n");
}
