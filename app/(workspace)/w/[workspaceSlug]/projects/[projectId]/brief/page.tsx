import Link from "next/link";

import { getBrief, getBriefWithRevisions } from "@/lib/queries/brief";
import type { TeamAnswersViewQuestion } from "@/components/brief/team-answers-view";
import { BriefSectionedView } from "@/components/brief/brief-sectioned-view";
import { GenerateDocumentButton } from "@/components/brief/generate-document-button";
import { RequestApprovalButton } from "@/components/brief/request-approval-button";
import { ApproveBriefButton } from "@/components/brief/approve-brief-button";
import { WithdrawApprovalButton } from "@/components/brief/withdraw-approval-button";
import { DocClientVisibilityToggle } from "@/components/docs/doc-client-visibility-toggle";
import { NotificationRecipientsPointer } from "@/components/brief/notification-recipients-pointer";
import { BriefHeader } from "@/components/brief/brief-header";
import { BriefApprovalStatus } from "@/components/brief/brief-approval-status";
import {
  getDecisionOwners,
  getLatestApprovalForSubject,
} from "@/lib/queries/approvals";
import { isBriefAnswerAnswered } from "@/lib/brief/is-answered";
import { pickLatestAnsweredRow } from "@/lib/brief/latest-answer";
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

  // F069 (AS-138): recipients of the brief_answer_changed notification
  // (F068, lib/notifications/fanout.ts's notifyDecisionOwnersOfAnswerChange)
  // are project_decision_owners -- already configurable per project via
  // project settings' "Who approves what" (components/approvals/
  // decision-owners.tsx). This is a read-only pointer to that existing
  // configurable list, not a second UI for editing it.
  const decisionOwnersResult = await getDecisionOwners(projectId);
  const decisionOwnerNames = decisionOwnersResult.ok
    ? decisionOwnersResult.data
        .map((owner) => owner.name)
        .filter((name): name is string => !!name)
    : [];

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
    answers
      .filter((answer) => answer.questionId)
      .map((answer) => [answer.questionId, answer]),
  );

  // F066 (AS-130): `hasRevisions` now comes straight off each answer row
  // (resolved in lib/queries/brief.ts's loadBriefWithQuestionsAndAnswers
  // via one batched brief_answer_revisions lookup), so no per-question
  // getBriefWithRevisions round trip is needed here anymore.
  // F067 (AS-132): fetch the full revision history only for questions
  // whose answer is already known to have at least one revision
  // (hasRevisions, from F066's batched lookup) -- avoids a
  // getBriefWithRevisions round trip per unedited question.
  const items: TeamAnswersViewQuestion[] = await Promise.all(
    questions.map(async (question) => {
      const answer = answersByQuestionId.get(question.id) ?? null;
      const hasRevisions = answer?.hasRevisions ?? false;
      if (!hasRevisions) {
        return { question, answer, hasRevisions };
      }
      const revisionsResult = await getBriefWithRevisions(
        brief.id,
        question.id,
      );
      const revisions =
        revisionsResult.ok && revisionsResult.data
          ? revisionsResult.data.revisions
          : [];
      return { question, answer, hasRevisions, revisions };
    }),
  );

  const isAnswered = (q: (typeof questions)[number]) =>
    isBriefAnswerAnswered(q, answersByQuestionId.get(q.id));
  const answeredCount = questions.filter(isAnswered).length;
  const requiredMissingCount = questions.filter(
    (q) => q.required && !isAnswered(q),
  ).length;
  const latestAnswer = pickLatestAnsweredRow(
    answers,
    new Map(questions.map((q) => [q.id, q])),
  );

  // AS-139: generating a document is only offered once there is
  // something to quote (F071 -- "the team can generate a brief document
  // from the answers") and only while no brief doc exists yet for this
  // project, since generateBriefDocument always inserts a fresh `docs`
  // row rather than updating one in place.
  const hasAnswers = answers.length > 0;
  // F072 (AS-143): the generated document defaults to `client_visible =
  // false` (docs' own column default, 20261014010000_f022_links_
  // accounts_docs_visibility.sql -- generateBriefDocument never sets it,
  // so it inherits that default) and stays hidden from the client's
  // portal until a team member flips this toggle. Loaded here so the
  // team page can both link to the doc (F073, AS-144) and show/control
  // its current sharing state without a second navigation.
  let existingDocument: { id: string; clientVisible: boolean } | null = null;
  // A failed lookup is not "no document": offering Generate Document then
  // could create a duplicate on a transient error.
  let documentLookupFailed = false;
  if (hasAnswers) {
    const supabase = await createClient();
    const { data: existingDoc, error: existingDocError } = await supabase
      .from("docs")
      .select("id, client_visible")
      .eq("project_id", projectId)
      .eq("doc_kind", "brief")
      .limit(1)
      .maybeSingle();
    if (existingDocError) documentLookupFailed = true;
    existingDocument = existingDoc
      ? { id: existingDoc.id, clientVisible: existingDoc.client_visible }
      : null;
  }

  // F078 (AS-152): the current state of the request F074's
  // requestBriefApproval created for this doc, if any -- most recent
  // request wins (same convention getLatestApprovalForSubject documents
  // itself).
  const briefApproval = existingDocument
    ? await getLatestApprovalForSubject("doc", existingDocument.id)
    : null;

  return (
    <div className="p-6 pt-4 lg:p-8 lg:pt-8">
      <BriefHeader
        answeredCount={answeredCount}
        totalCount={questions.length}
        requiredMissingCount={requiredMissingCount}
        lastModifiedBy={latestAnswer?.answeredByName ?? null}
        lastModifiedAt={latestAnswer?.updatedAt ?? null}
        meta={
          <NotificationRecipientsPointer
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            recipientNames={decisionOwnerNames}
          />
        }
        actions={
          hasAnswers ? (
            <>
              {existingDocument ? (
                <>
                  <Link
                    href={`/w/${workspaceSlug}/projects/${projectId}/docs/${existingDocument.id}`}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    View document
                  </Link>
                  <DocClientVisibilityToggle
                    docId={existingDocument.id}
                    clientVisible={existingDocument.clientVisible}
                  />
                  {brief.state !== "approved" ? (
                    <>
                      {/* F074 (AS-145/AS-146): request approval of the
                      generated brief document. */}
                      <RequestApprovalButton
                        projectId={projectId}
                        documentId={existingDocument.id}
                      />
                      {/* F075 (AS-147): team-side approval, sets
                      brief.state to 'approved'. */}
                      <ApproveBriefButton briefId={brief.id} />
                    </>
                  ) : (
                    // F077 (AS-151): only offered once approved -- withdrawal
                    // reverts brief.state to 'submitted', which unlocks
                    // answers again (F076's brief.state !== 'approved' checks).
                    <WithdrawApprovalButton briefId={brief.id} />
                  )}
                </>
              ) : documentLookupFailed ? (
                <p className="text-sm text-warning" role="alert">
                  Couldn&apos;t check for an existing brief document, so the
                  Generate Document, Request Approval and Approve actions are
                  unavailable until you reload the page.
                </p>
              ) : (
                <GenerateDocumentButton
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  briefId={brief.id}
                  disabled={requiredMissingCount > 0}
                />
              )}
            </>
          ) : null
        }
      />
      <BriefApprovalStatus
        workspaceSlug={workspaceSlug}
        state={briefApproval?.state ?? null}
      />
      <BriefSectionedView items={items} />
    </div>
  );
}
