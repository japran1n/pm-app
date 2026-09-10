import { getBrief, getBriefWithRevisions } from "@/lib/queries/brief";
import {
  TeamAnswersView,
  type TeamAnswersViewQuestion,
} from "@/components/brief/team-answers-view";

// F054 (AS-130): team-side brief route. Server Component per the same
// data-fetching pattern board/page.tsx uses -- data resolved here, handed
// down as plain props to the purely presentational <TeamAnswersView>.
//
// Access relies on the project detail layout's guard one level up (same
// note as board/page.tsx) -- no duplicate page-level gate here.
export default async function ProjectBriefPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const briefResult = await getBrief(projectId);

  if (!briefResult.ok) {
    return (
      <div className="p-6 pt-4 lg:p-8 lg:pt-8">
        <p className="text-sm text-destructive">Failed to load the brief.</p>
      </div>
    );
  }

  const { brief, questions, answers } = briefResult.data;

  if (!brief || questions.length === 0) {
    return (
      <div className="p-6 pt-4 lg:p-8 lg:pt-8">
        <p className="text-sm text-muted-foreground">
          No questionnaire yet. Add questions to get started.
        </p>
      </div>
    );
  }

  const answersByQuestionId = new Map(
    answers.filter((answer) => answer.questionId).map((answer) => [answer.questionId, answer]),
  );

  // AS-130: per answered question, resolve whether it has any revisions
  // at all (edited at least once) via getBriefWithRevisions -- run
  // alongside each other rather than sequentially awaited, same pattern
  // board/page.tsx uses for its independent fetches.
  const items: TeamAnswersViewQuestion[] = await Promise.all(
    questions.map(async (question) => {
      const answer = answersByQuestionId.get(question.id) ?? null;
      if (!answer) {
        return { question, answer: null, hasRevisions: false };
      }
      const revisionsResult = await getBriefWithRevisions(brief.id, question.id);
      const hasRevisions =
        revisionsResult.ok && !!revisionsResult.data && revisionsResult.data.revisions.length > 0;
      return { question, answer, hasRevisions };
    }),
  );

  return (
    <div className="p-6 pt-4 lg:p-8 lg:pt-8">
      <TeamAnswersView items={items} />
    </div>
  );
}
