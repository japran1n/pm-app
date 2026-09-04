// F023 (missions/20260903-portal, AS-051): the "Guides" section of the
// portal's "Your site" view -- client-visible docs with
// `doc_kind = 'training'`. `docs` is already RLS-scoped (a client caller
// only ever sees `client_visible = true` rows of a project it belongs to,
// lib/queries/docs.ts's own header comment) and pre-filtered to
// `doc_kind === 'training'` by the caller.
//
// No `duration` column exists on `docs` anywhere in this schema (grepped:
// no migration names one) -- "as cards with a duration where the doc
// records one" is honoured by never showing a duration at all, since none
// is ever recorded, rather than inventing a placeholder value.
//
// Empty state says training arrives at handover -- not "nothing here",
// which would read as broken.
//
// No portal route exists for a single doc (grepped: nothing under
// app/(portal) matches `docs`) -- these cards render the guide inline
// (title + a content preview) rather than linking to the team-only doc
// editor a client session cannot reach; building that route is out of
// this feature's own scope.
import { GraduationCap } from "lucide-react";

import type { Doc } from "@/lib/queries/docs";
import { EmptyState } from "@/components/empty-state";

export function ProjectGuidesList({ guides }: { guides: Doc[] }) {
  if (guides.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Training guides arrive at handover."
        description="Once the site is ready to hand over, walkthroughs and how-tos for running it will show up here."
        testId="project-guides-empty"
      />
    );
  }

  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      data-testid="project-guides-list"
    >
      {guides.map((doc) => (
        <li
          key={doc.id}
          className="flex h-full flex-col gap-1 rounded-md border border-border p-3"
          data-testid="project-guide-card"
        >
          <span className="text-sm font-medium text-foreground">{doc.title}</span>
          <span className="line-clamp-2 text-tag text-muted-foreground">
            {doc.content ? doc.content.slice(0, 140) : "No description yet."}
          </span>
        </li>
      ))}
    </ul>
  );
}
