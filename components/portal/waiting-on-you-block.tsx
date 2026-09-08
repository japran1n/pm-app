// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.2):
// "What we need from you" -- first, not fourth. Renders the items built
// by `buildWaitingOnYouItems` (lib/portal/build-waiting-on-you-items.ts)
// as a named list with age and an inline action, instead of the single
// number the tile above still carries (that tile is untouched -- see
// overview-tiles.tsx's own header for why the count stays there too).
import Link from "next/link";
import { ClipboardCheck, KeyRound, PackageX, Stamp } from "lucide-react";

import type {
  WaitingOnYouItem,
  WaitingOnYouItemKind,
} from "@/lib/portal/build-waiting-on-you-items";

// F107 round 2 (coordinator review): a single shared icon across all
// three kinds made an approval, a pending-approval task and an overdue
// deliverable indistinguishable at a glance, despite being three
// different asks with three different actions. Each kind now gets its
// own icon; no colour-only encoding either way -- the icon is always
// paired with its own label text (the row's title plus `agedLabel`
// below), so the distinction never rests on the glyph alone.
const KIND_ICON: Record<WaitingOnYouItemKind, typeof Stamp> = {
  // A non-task-subject approval (doc/phase/artifact) -- a decision to
  // make, not a task to open.
  approval: Stamp,
  // A task sitting in `pending_client_approval` -- something to review
  // inside its own task detail page.
  task: ClipboardCheck,
  // A past-due deliverable -- something missing/overdue, not a decision
  // to render.
  deliverable: PackageX,
  // A `project_accounts` row the client owns but hasn't provisioned yet
  // -- access to hand over, not a review or an overdue file.
  account: KeyRound,
};

function agedLabel(daysWaiting: number, kind: WaitingOnYouItemKind): string {
  // Accounts carry no "raised at" timestamp in the current schema (see
  // `buildWaitingOnYouItems`'s own comment) -- always render the neutral
  // "Needs access" copy rather than an age claim the data can't back up.
  if (kind === "account") return "Needs access";
  const noun = kind === "deliverable" ? "overdue" : "waiting";
  if (daysWaiting === 0) return kind === "deliverable" ? "Due today" : "Asked today";
  if (daysWaiting === 1) return `1 day ${noun}`;
  return `${daysWaiting} days ${noun}`;
}

export function WaitingOnYouBlock({ items }: { items: WaitingOnYouItem[] }) {
  // F115 round 2 (coordinator review, docs/client-portal-phase-2-plan.md
  // C): this used to render its own "Nothing waiting on you right now."
  // empty state -- a second, near-identical sentence on the same screen
  // as the launch headline's own "Nothing needed from you right now."
  // (`buildNextFromYouAnswer`'s case 4), the copy equivalent of the
  // Overview's earlier duplicate-count bug. The headline sits where the
  // client reads first, so it keeps the sentence; this block renders
  // nothing at all rather than restating it a screen-height lower.
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="waiting-on-you-block"
      className="flex flex-col gap-1 rounded-lg border border-border p-2"
    >
      <h2 className="px-3 pt-2 text-mini font-semibold text-foreground">What we need from you</h2>
      <ul className="flex flex-col">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                data-testid={`waiting-on-you-item-${item.key}`}
                className="hover-surface flex items-center justify-between gap-3 rounded-md px-3 py-2 text-mini"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-status-waiting" />
                  <span className="min-w-0 truncate font-medium">{item.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-micro text-muted-foreground">
                    {agedLabel(item.daysWaiting, item.kind)}
                  </span>
                  <span className="text-micro font-medium text-brand">{item.actionLabel}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
