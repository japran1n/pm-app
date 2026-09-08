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
//
// Paket F (client-portal-phase plan, "Your site" scan/nav redesign):
// cards get a leading icon to match the Links section's visual language.
// `docKind` is always "training" on every guide reaching this component
// (the caller pre-filters to that one kind, per this file's own header
// comment) so there's no per-card variance to map -- every card gets the
// same `GraduationCap` glyph rather than inventing a kind that doesn't
// exist in the schema.
//
// Follow-up fix ("Guides kartica - popravi tekst i ucini klikabilnom"): the
// preview text used to be a raw `.slice(0, 140)` -- a mid-word cut with no
// visual truncation cue, so long descriptions looked broken/cut off. That's
// replaced with a proper `line-clamp-3` on the untruncated content (CSS
// ellipsis, not a hard slice). Since (per this file's own header comment
// above) there's still no per-guide portal route to link to, the whole card
// is now a `<button>` that opens a Dialog (components/ui/dialog.tsx) showing
// the guide's full title + full content -- same "no dead-end editor link"
// reasoning as before, but the full text is now actually reachable instead
// of permanently truncated.
"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";

import type { Doc } from "@/lib/queries/docs";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ProjectGuidesList({ guides }: { guides: Doc[] }) {
  const [openGuide, setOpenGuide] = useState<Doc | null>(null);

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
    <>
      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="project-guides-list"
      >
        {guides.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() => setOpenGuide(doc)}
              className="hover-surface flex h-full w-full flex-col gap-2 rounded-lg border border-border p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"
              data-testid="project-guide-card"
            >
              <GraduationCap
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-mini font-medium text-foreground">
                {doc.title}
              </span>
              <span className="line-clamp-3 text-tag text-muted-foreground">
                {doc.content ? doc.content : "No description yet."}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={openGuide !== null}
        onOpenChange={(open) => {
          if (!open) setOpenGuide(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{openGuide?.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap text-foreground">
              {openGuide?.content || "No description yet."}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
