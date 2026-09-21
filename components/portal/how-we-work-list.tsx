// F114 (client-portal-phase-2-plan.md, items E-H): "How we work" — one
// portal section, four kinds of client-facing writing. Renders in the
// order the server already computed (lib/queries/how-we-work.ts sorts by
// the project's current stage before this component ever sees the
// list) — this component does no re-sorting of its own.
//
// Handover's own note: "a bare Loom or YouTube URL is a dead link" —
// each `doc_links` row renders as a small card with title, description,
// and thumbnail (when one was given; a manual field, not an OG fetch —
// see this feature's handoff for that call), never a bare `<a href>`.
import { BookOpen, HelpCircle, MessageSquareText, Rocket } from "lucide-react";

import type { HowWeWorkEntry } from "@/lib/queries/how-we-work";
import type { HowWeWorkDocKind } from "@/lib/validation/project-site";
import { EmptyState } from "@/components/empty-state";
import { DocLinksGrid } from "@/components/portal/doc-links-grid";

const KIND_LABEL: Record<HowWeWorkDocKind, string> = {
  onboarding: "Getting started",
  feedback: "Giving feedback",
  portal_guide: "Using this dashboard",
  handover: "Handover",
};

const KIND_ICON: Record<HowWeWorkDocKind, typeof Rocket> = {
  onboarding: Rocket,
  feedback: MessageSquareText,
  portal_guide: HelpCircle,
  handover: BookOpen,
};

export function HowWeWorkList({ entries }: { entries: HowWeWorkEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Nothing here yet."
        description="Onboarding notes, feedback guidance, and handover material will show up here as the project moves forward."
        testId="how-we-work-empty"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4" data-testid="how-we-work-list">
      {entries.map((entry) => {
        const Icon = KIND_ICON[entry.docKind];
        return (
          <li
            key={entry.id}
            className="flex flex-col gap-2 rounded-md border border-border p-4"
            data-testid="how-we-work-card"
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                {KIND_LABEL[entry.docKind]}
              </span>
            </div>
            <span className="text-sm font-semibold text-foreground">{entry.title}</span>
            {entry.content && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{entry.content}</p>
            )}
            {entry.links.length > 0 && (
              <div data-testid="how-we-work-links">
                <DocLinksGrid links={entry.links} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
