// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.2):
// "What we need from you" -- first, not fourth. Renders the items built
// by `buildWaitingOnYouItems` (lib/portal/build-waiting-on-you-items.ts)
// as a named list with age and an inline action, instead of the single
// number the tile above still carries (that tile is untouched -- see
// overview-tiles.tsx's own header for why the count stays there too).
import Link from "next/link";
import { CheckCircle2, Circle, FileClock } from "lucide-react";

import type {
  WaitingOnYouItem,
  WaitingOnYouItemKind,
} from "@/lib/portal/build-waiting-on-you-items";

// No colour-only encoding: each kind gets its own icon AND its own
// label text (below, in the row itself) so the distinction survives
// greyscale, per this feature's own chart-rules instruction.
const KIND_ICON: Record<WaitingOnYouItemKind, typeof Circle> = {
  approval: FileClock,
  task: FileClock,
  deliverable: FileClock,
};

function agedLabel(daysWaiting: number, kind: WaitingOnYouItemKind): string {
  const noun = kind === "deliverable" ? "overdue" : "waiting";
  if (daysWaiting === 0) return kind === "deliverable" ? "Due today" : "Asked today";
  if (daysWaiting === 1) return `1 day ${noun}`;
  return `${daysWaiting} days ${noun}`;
}

export function WaitingOnYouBlock({ items }: { items: WaitingOnYouItem[] }) {
  if (items.length === 0) {
    return (
      <div
        data-testid="waiting-on-you-block"
        className="flex items-center gap-2 rounded-lg border border-border p-5 text-sm text-muted-foreground"
      >
        <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-status-done" />
        <span data-testid="waiting-on-you-empty">Nothing waiting on you right now.</span>
      </div>
    );
  }

  return (
    <div
      data-testid="waiting-on-you-block"
      className="flex flex-col gap-1 rounded-lg border border-border p-2"
    >
      <h2 className="px-3 pt-2 text-sm font-semibold text-foreground">What we need from you</h2>
      <ul className="flex flex-col">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                data-testid={`waiting-on-you-item-${item.key}`}
                className="hover-surface flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-status-waiting" />
                  <span className="min-w-0 truncate font-medium">{item.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {agedLabel(item.daysWaiting, item.kind)}
                  </span>
                  <span className="text-xs font-medium text-brand">{item.actionLabel}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
