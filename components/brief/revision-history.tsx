"use client";

// F067 (AS-132): "The full revision history of an answer can be
// expanded." Client component wrapping a plain toggle -- the server page
// already resolved the full revision list via getBriefWithRevisions, so
// this component has no data fetching of its own, only local expand
// state. Collapsed by default so team-answers-view.tsx (a Server
// Component) stays free of interactive markup for answers that were
// never edited.
//
// Deliberately local/ephemeral (useState, no route, no persisted
// server-side "expanded" flag, no write to any activity/audit table) --
// this is what keeps F070's "brief revisions are presented separately
// from the project activity feed" true: opening this history never
// creates or reads a feed entry, it just toggles visibility of data
// already on the page.
import { useState } from "react";

import type { BriefAnswerRevision } from "@/lib/queries/brief";

function formatChangedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function revisionPreviousValue(revision: BriefAnswerRevision): string {
  if (revision.previousOptions && revision.previousOptions.length > 0) {
    return revision.previousOptions.join(", ");
  }
  if (revision.previousText) {
    return revision.previousText;
  }
  return "(empty)";
}

export function RevisionHistory({ revisions }: { revisions: BriefAnswerRevision[] }) {
  const [expanded, setExpanded] = useState(false);

  if (revisions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        aria-expanded={expanded}
      >
        {expanded ? "Hide history" : "Show history"}
      </button>
      {expanded ? (
        <ul className="flex flex-col gap-1.5 border-l border-border pl-3">
          {revisions.map((revision) => (
            <li key={revision.id} className="text-xs text-muted-foreground">
              Changed by {revision.changedByName ?? "Unknown"} on{" "}
              {formatChangedAt(revision.changedAt)}: &lsquo;{revisionPreviousValue(revision)}
              &rsquo;
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
