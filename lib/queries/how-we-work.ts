// F114 (client-portal-phase-2-plan.md, items E-H): "How we work" — the
// portal section built from `docs` rows whose `doc_kind` is one of the
// four "written for the client to read" kinds (onboarding, feedback,
// portal_guide, handover). Reuses `getClientVisibleDocs`
// (lib/queries/docs.ts) rather than a parallel query — RLS and the
// explicit `client_visible = true` double-guard it already applies are
// exactly what this section needs too (same convention this mission's
// other portal query files follow, see lib/queries/docs.ts's own header
// comment on getClientVisibleDocs).
//
// Ordering ("the section should lead with what matters now", this
// feature's own spec): each doc can say when it becomes relevant
// (`relevant_from`: kickoff / ongoing / launch / null-for-"always").
// The project's current stage is derived from its own `project_phases`
// state — no separate "stage" column exists anywhere in this schema
// (grepped: no migration adds one), so this infers it from data that's
// already there rather than inventing a new field for a project-level
// concept the portal doesn't otherwise track:
//   - no phases at all, or every phase still `not_started` -> kickoff
//   - every phase `done` -> launch
//   - anything else (some phase `active`/`blocked`, or a mix) -> ongoing
import { createClient } from "@/lib/supabase/server";

import { getClientVisibleDocs, getDocLinksForDocs, type Doc, type DocLink } from "@/lib/queries/docs";
import { howWeWorkDocKinds, type HowWeWorkDocKind } from "@/lib/validation/project-site";

export type ProjectStage = "kickoff" | "ongoing" | "launch";

export type HowWeWorkEntry = Doc & { docKind: HowWeWorkDocKind; links: DocLink[] };

export async function getProjectStage(projectId: string): Promise<ProjectStage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_phases")
    .select("state")
    .eq("project_id", projectId);

  if (error || !data || data.length === 0) {
    return "kickoff";
  }

  const states = data.map((row) => row.state);

  if (states.every((state) => state === "done")) {
    return "launch";
  }

  if (states.every((state) => state === "not_started")) {
    return "kickoff";
  }

  return "ongoing";
}

// Default "when this becomes relevant" for a kind that has never had its
// own `relevant_from` set explicitly — onboarding is naturally a kickoff
// thing and handover a launch thing; feedback and the portal guide apply
// "throughout" (this feature's own spec table), i.e. always.
function defaultRelevance(kind: HowWeWorkDocKind): ProjectStage | "always" {
  if (kind === "onboarding") return "kickoff";
  if (kind === "handover") return "launch";
  return "always";
}

// Per-stage priority order over effective relevance ("always" entries
// stay near the top at every stage — they matter now too, just not
// exclusively). Ties (two entries at the same rank) keep their
// `position` order.
const STAGE_PRIORITY: Record<ProjectStage, Array<ProjectStage | "always">> = {
  kickoff: ["kickoff", "always", "ongoing", "launch"],
  ongoing: ["always", "ongoing", "kickoff", "launch"],
  launch: ["launch", "always", "ongoing", "kickoff"],
};

export async function getHowWeWorkEntries(
  workspaceId: string,
  projectId: string,
): Promise<{ stage: ProjectStage; entries: HowWeWorkEntry[] }> {
  const [docs, stage] = await Promise.all([
    getClientVisibleDocs(workspaceId, projectId),
    getProjectStage(projectId),
  ]);

  const howWeWorkDocs = docs.filter((doc): doc is Doc & { docKind: HowWeWorkDocKind } =>
    (howWeWorkDocKinds as readonly string[]).includes(doc.docKind),
  );

  const linksByDoc = await getDocLinksForDocs(howWeWorkDocs.map((doc) => doc.id));

  const priority = STAGE_PRIORITY[stage];

  const entries: HowWeWorkEntry[] = howWeWorkDocs.map((doc) => ({
    ...doc,
    links: linksByDoc.get(doc.id) ?? [],
  }));

  entries.sort((a, b) => {
    const effectiveA = a.relevantFrom ?? defaultRelevance(a.docKind);
    const effectiveB = b.relevantFrom ?? defaultRelevance(b.docKind);
    const rankA = priority.indexOf(effectiveA);
    const rankB = priority.indexOf(effectiveB);
    if (rankA !== rankB) return rankA - rankB;
    return a.position - b.position;
  });

  return { stage, entries };
}
