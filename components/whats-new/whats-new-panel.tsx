"use client";

// Feature request: a static in-app "What's new" panel -- a hand-written,
// hardcoded list of recently shipped features (this is intentionally NOT
// data-driven off `plan.md`/mission state; a real changelog feed is out of
// this feature's scope). Opens from a header button; a small "new"
// indicator dot on that button persists until the user opens this panel at
// least once, tracked via a localStorage timestamp -- matches
// lib/notifications/browser-notify.ts's own "local-only, not a server
// column" convention for this kind of lightweight, per-browser UI state
// (a real `workspace_members.last_seen_whats_new_at` column was the other
// option this feature's own note raised; skipped for the same reason no
// migration/DB round-trip is worth it for a purely cosmetic dot).
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STORAGE_KEY = "whats-new-last-seen-at";

// Bump this whenever a new entry is added below -- it's what "last seen"
// is compared against to decide whether the indicator dot shows. A plain
// ISO date works fine as a string comparison key since every entry below
// is already listed newest-first with its own date.
const LATEST_ENTRY_DATE = "2026-09-06";

type WhatsNewEntry = {
  date: string;
  title: string;
  description: string;
};

// Hand-written from this session's own work -- see this feature's own
// spec for the exact list to seed. Newest first.
const ENTRIES: WhatsNewEntry[] = [
  {
    date: "2026-09-06",
    title: "Desktop notifications & unread badges",
    description:
      "Opt-in browser notifications for @mentions and approvals, plus unread-count badges on Chat and Approvals in the sidebar.",
  },
  {
    date: "2026-09-05",
    title: "Chat & direct messages",
    description:
      "Channel and DM messaging with threads, @mentions, reactions, and realtime delivery.",
  },
  {
    date: "2026-08-28",
    title: "Calendar & planner",
    description:
      "A workspace-wide calendar view of task due dates and client presentations.",
  },
  {
    date: "2026-08-20",
    title: "Time tracking",
    description:
      "Start/stop timers on any task, a global tracker widget, and per-person time reports.",
  },
  {
    date: "2026-08-10",
    title: "Views with filters",
    description:
      "Saved, filterable board/list views for a project's tasks, beyond the default board.",
  },
  {
    date: "2026-08-01",
    title: "Team directory",
    description:
      "A per-person profile page showing their projects, assigned tasks, and time report.",
  },
];

export function hasUnseenWhatsNew(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const lastSeen = window.localStorage.getItem(STORAGE_KEY);
    return !lastSeen || lastSeen < LATEST_ENTRY_DATE;
  } catch {
    // Same "private-browsing localStorage throws" defensiveness as
    // browser-notify.ts -- treat as "nothing new" rather than crash.
    return false;
  }
}

function markWhatsNewSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, LATEST_ENTRY_DATE);
  } catch {
    // See hasUnseenWhatsNew's own comment.
  }
}

export function WhatsNewPanel() {
  const [open, setOpen] = useState(false);
  // BUGFIX (hydration mismatch): a lazy `useState(() => hasUnseenWhatsNew())`
  // initializer still reads real per-browser localStorage on the FIRST
  // CLIENT render pass, which never matches the server's render (no
  // localStorage there, so the server always renders the "seen" default)
  // -- a classic SSR/CSR mismatch React has to discard-and-regenerate the
  // whole subtree for. Fixed with the standard "mounted" guard: start at
  // the same default the server used (`false`, i.e. "nothing unseen") and
  // only flip to the real value in a `useEffect`, which never runs during
  // SSR and never runs on the client until AFTER hydration has already
  // committed a matching tree.
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    // This is the standard "mounted guard" escape hatch for exactly one
    // synchronous read of an external (non-React) source of truth right
    // after the mismatch-free initial commit -- there is no cascading
    // render risk `react-hooks/set-state-in-effect` otherwise warns about
    // (this effect has no dependencies and runs exactly once per mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnseen(hasUnseenWhatsNew());
  }, []);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      markWhatsNewSeen();
      setUnseen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative max-md:size-11"
        aria-label={unseen ? "What's new, unseen updates" : "What's new"}
        onClick={() => handleOpenChange(true)}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        {unseen && (
          <span
            className="absolute -top-1 -right-1 size-2.5 rounded-full border border-background bg-destructive"
            aria-hidden="true"
            data-testid="whats-new-unseen-dot"
          />
        )}
      </Button>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What&apos;s new</DialogTitle>
          <DialogDescription>Recently added to this workspace.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {ENTRIES.map((entry) => (
            <li key={entry.title} className="flex flex-col gap-1 border-b pb-4 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-mini font-medium">{entry.title}</p>
                <p className="text-micro text-muted-foreground">{entry.date}</p>
              </div>
              <p className="text-mini text-muted-foreground">{entry.description}</p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
