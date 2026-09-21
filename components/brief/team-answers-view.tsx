// F054 (AS-130): the team's read view of brief answers.
//
// Mission 20260910-182104, milestone M6 (Brief: schema and team side).
//
// Server Component -- no interactive state here at all, so there is no
// client boundary to carve out (unlike board/page.tsx's Board, which needs
// DndContext). Renders every brief_question in position order
// (lib/queries/brief.ts's getBrief already orders by `position`), pairs
// each with its answer by `questionId`, and shows a muted placeholder for
// anything unanswered.
//
// AS-130 ("the team sees an indication that an answer has been edited"):
// the page passes down a `hasRevisions` flag per answer, precomputed via
// getBriefWithRevisions (checking `revisions.length > 0`) rather than this
// component re-querying -- keeps this file a pure presentational read of
// already-resolved data, same split as the rest of the brief queries.
import { Badge } from "@/components/ui/badge";
import { isBriefAnswerAnswered } from "@/lib/brief/is-answered";
import { RevisionHistory } from "@/components/brief/revision-history";
import type { BriefAnswer, BriefAnswerRevision, BriefQuestion } from "@/lib/queries/brief";

export type TeamAnswersViewQuestion = {
  question: BriefQuestion;
  answer: BriefAnswer | null;
  hasRevisions: boolean;
  // F067 (AS-132): the full revision history for this answer, resolved
  // server-side (getBriefWithRevisions) only when hasRevisions is true.
  // Undefined/empty for unedited answers -- <RevisionHistory> renders
  // nothing in that case, so this stays a no-op for the common path.
  revisions?: BriefAnswerRevision[];
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Only rendered for answers isBriefAnswerAnswered() accepted (see TeamAnswersView).
function AnswerValue({ question, answer }: { question: BriefQuestion; answer: BriefAnswer }) {
  if (question.answerType === "single_choice" || question.answerType === "multi_choice") {
    const selected = answer.answerOptions ?? [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {selected.map((option) => (
          <Badge key={option} variant="outline" className="rounded-md px-2 py-0.5 text-sm font-normal normal-case tracking-normal">
            {option}
          </Badge>
        ))}
      </div>
    );
  }

  if (question.answerType === "long_text") {
    return <p className="whitespace-pre-wrap text-base text-foreground">{answer.answerText}</p>;
  }

  return <p className="text-base text-foreground">{answer.answerText}</p>;
}

export function TeamAnswersView({ items }: { items: TeamAnswersViewQuestion[] }) {
  return (
    <div className="flex max-w-[720px] w-full flex-col gap-6">
      {items.map(({ question, answer, hasRevisions, revisions }) => {
        const isAnswered = isBriefAnswerAnswered(question, answer);

        return (
          <div key={question.id} className="flex flex-col gap-2 border-b border-border pb-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">
                  {question.prompt}
                  {question.required && !isAnswered ? (
                    <span className="ml-1 text-destructive" aria-label="required">
                      *
                    </span>
                  ) : null}
                </p>
              </div>
              {isAnswered && hasRevisions ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="warning" aria-label="This answer has been edited">
                    Edited
                  </Badge>
                </div>
              ) : null}
            </div>
            {isAnswered && answer ? (
              <>
                <AnswerValue question={question} answer={answer} />
                <p className="text-xs text-muted-foreground">
                  <span>{answer.answeredByName ?? "Someone"}</span>
                  {" · "}
                  <span className="font-mono">{formatRelative(answer.updatedAt)}</span>
                </p>
              </>
            ) : question.required ? (
              <p className="text-sm text-warning">Not answered</p>
            ) : (
              <p className="text-sm text-muted-foreground">Not answered yet</p>
            )}
            {isAnswered && hasRevisions && revisions && revisions.length > 0 ? (
              <RevisionHistory revisions={revisions} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
