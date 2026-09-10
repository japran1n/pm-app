import { ScrollText } from "lucide-react";

import { getBriefForClient } from "@/lib/queries/brief";
import { EmptyState } from "@/components/empty-state";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";

// F055 (missions/20260910-182104, AS-113, AS-114): the client-facing
// questionnaire route. Access to this segment is already gated by the
// project layout one level up (`[projectId]/layout.tsx`) -- it re-resolves
// the project via `getPortalProjects` (portal_enabled + client membership)
// and 404s otherwise, the same convention every sibling view under this
// layout (scope/page.tsx, your-list/page.tsx, etc.) relies on rather than
// duplicating a guard here. `getBriefForClient` additionally relies on
// F046's RLS policies to filter rows to this client's own project -- see
// that function's own comment in lib/queries/brief.ts.
export default async function PortalBriefPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const briefResult = await getBriefForClient(projectId);

  if (!briefResult.ok) {
    return (
      <EmptyState
        icon={ScrollText}
        title="We couldn't load your questionnaire."
        description="Something went wrong loading this project's questionnaire. Try refreshing the page."
        testId="brief-error"
      />
    );
  }

  const { brief, questions, answers } = briefResult.data;

  if (questions.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No questionnaire available"
        description="There isn't a questionnaire for this project yet. Check back later."
        testId="brief-empty"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PortalQuestionnaire
        questions={questions}
        initialAnswers={answers}
        briefId={brief?.id ?? null}
      />
    </div>
  );
}
