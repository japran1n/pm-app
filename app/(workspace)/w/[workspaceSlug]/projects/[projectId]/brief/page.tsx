import { getBrief } from "@/lib/queries/brief";
import {
  TeamAnswersView,
  type TeamAnswersViewQuestion,
} from "@/components/brief/team-answers-view";
import { GenerateDocumentButton } from "@/components/brief/generate-document-button";
import { createClient } from "@/lib/supabase/server";

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
  const { workspaceSlug, projectId } = await params;

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

  // F066 (AS-130): `hasRevisions` now comes straight off each answer row
  // (resolved in lib/queries/brief.ts's loadBriefWithQuestionsAndAnswers
  // via one batched brief_answer_revisions lookup), so no per-question
  // getBriefWithRevisions round trip is needed here anymore.
  const items: TeamAnswersViewQuestion[] = questions.map((question) => {
    const answer = answersByQuestionId.get(question.id) ?? null;
    return { question, answer, hasRevisions: answer?.hasRevisions ?? false };
  });

  // AS-139: generating a document is only offered once there is
  // something to quote (F071 -- "the team can generate a brief document
  // from the answers") and only while no brief doc exists yet for this
  // project, since generateBriefDocument always inserts a fresh `docs`
  // row rather than updating one in place.
  const hasAnswers = answers.length > 0;
  let hasExistingDocument = false;
  if (hasAnswers) {
    const supabase = await createClient();
    const { data: existingDoc } = await supabase
      .from("docs")
      .select("id")
      .eq("project_id", projectId)
      .eq("doc_kind", "brief")
      .limit(1)
      .maybeSingle();
    hasExistingDocument = !!existingDoc;
  }

  return (
    <div className="p-6 pt-4 lg:p-8 lg:pt-8">
      {hasAnswers && !hasExistingDocument ? (
        <div className="mb-4 flex justify-end">
          <GenerateDocumentButton
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            briefId={brief.id}
          />
        </div>
      ) : null}
      <TeamAnswersView items={items} />
    </div>
  );
}
