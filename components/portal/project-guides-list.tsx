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
//
// Fix ("Your site" -> Guides was empty for demo project, F114 kind gap):
// F114 (missions/20260903-portal handoff, client-portal-phase-2-plan.md
// items E-H) added `portal_guide` and `handover` as further "written for
// the client to read" doc kinds, surfaced on the separate "How we work"
// route (`how-we-work/page.tsx`, `HowWeWorkList`) -- but this Guides
// section was never widened to match, so a project whose only
// client-facing docs were `portal_guide`/`handover` (no `training` doc)
// showed nothing here even though "How we work" had content. The caller
// (`site/page.tsx`) now passes `training` + `portal_guide` + `handover`
// docs; `docKind` is threaded through per-card (no longer implicitly
// "always training") and each guide can carry its own `doc_links`
// (F114's manual title/description/thumbnail entries -- e.g. a handover
// doc's Loom walkthroughs), rendered via the same `DocLinksGrid`
// `how-we-work-list.tsx` already uses, not a duplicated grid.
"use client";

import { useState } from "react";
import { BookOpen, GraduationCap, HelpCircle, type LucideIcon } from "lucide-react";

import type { Doc, DocLink } from "@/lib/queries/docs";
import { EmptyState } from "@/components/empty-state";
import { DocLinksGrid } from "@/components/portal/doc-links-grid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ProjectGuide = Doc & { links?: DocLink[] };

const GUIDE_ICON: Record<string, LucideIcon> = {
  training: GraduationCap,
  portal_guide: HelpCircle,
  handover: BookOpen,
};

export function ProjectGuidesList({ guides }: { guides: ProjectGuide[] }) {
  const [openGuide, setOpenGuide] = useState<ProjectGuide | null>(null);

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
        {guides.map((doc) => {
          const Icon = GUIDE_ICON[doc.docKind] ?? GraduationCap;
          return (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => setOpenGuide(doc)}
                className="hover-surface flex h-full w-full flex-col gap-2 rounded-lg border border-border p-4 text-left transition-all duration-150 hover:-translate-y-0.5"
                data-testid="project-guide-card"
              >
                <Icon
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-foreground">
                  {doc.title}
                </span>
                <span className="line-clamp-3 text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                  {doc.content ? doc.content : "No description yet."}
                </span>
                {doc.links && doc.links.length > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {doc.links.length} {doc.links.length === 1 ? "link" : "links"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
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
          {openGuide?.links && openGuide.links.length > 0 && (
            <DocLinksGrid links={openGuide.links} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
