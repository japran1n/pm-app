// F005 (missions/20260903-portal, AS-017): the Pages view's distribution
// bar — one segment per client bucket (waiting on you / in progress /
// blocked / ready to launch), each carrying its own colour AND its count
// as a number AND its name as text in the key beneath. Per plan.md's
// Design constraint #4 ("state is never carried by colour alone"), the
// bar itself is decorative (aria-hidden) — the key below is the real,
// always-present accessible content, and is what a screen reader or a
// colour-blind reader actually relies on.
//
// A bucket with a zero count is omitted from the BAR (there is nothing to
// draw a segment for), but always still listed in the key as "0" — this
// feature's own explicit instruction, so "nothing is blocked right now"
// reads as a stated fact, not a silently missing row.
//
// Tokens only: the four `--status-*` bucket colours (app/globals.css,
// F004), never a literal hex here.

import { cn } from "@/lib/utils";
import { CLIENT_BUCKET_LABELS, type ClientBucket } from "@/components/portal/status-label";

const BUCKET_ORDER: ClientBucket[] = ["waiting", "progress", "blocked", "done"];

// F006g (missions/20260903-portal, AS-015, AS-017): the label half of
// this key used to be its own copy of the bucket -> name map (one of
// three, alongside pages-table.tsx's filter and status-manager.tsx's
// override select, the third of which had already drifted) -- now reads
// `CLIENT_BUCKET_LABELS` (status-label.ts), matching AS-017's own wording
// ("waiting on the client, in progress, blocked, and ready to launch")
// verbatim. `tone` (the bar/dot colour) stays local -- it is this
// component's own presentation concern, not part of what a bucket is
// called.
const BUCKET_TONE: Record<ClientBucket, string> = {
  waiting: "bg-status-waiting",
  progress: "bg-status-progress",
  blocked: "bg-status-blocked",
  done: "bg-status-done",
};

export function StatusDistribution({
  counts,
}: {
  counts: Record<ClientBucket, number>;
}) {
  const total = BUCKET_ORDER.reduce((sum, bucket) => sum + counts[bucket], 0);
  const segments = BUCKET_ORDER.filter((bucket) => counts[bucket] > 0);

  return (
    <div data-testid="status-distribution" className="flex flex-col gap-3">
      {/* AS-017: the bar — a single row of segments with a 2px gap
          between them (`gap-0.5` = 0.125rem = 2px), each segment's width
          proportional to its share of the total. Purely decorative: the
          key below carries the same information as real text, so this
          bar is hidden from assistive tech rather than announced twice
          or, worse, announced as colour alone. */}
      <div
        aria-hidden="true"
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {segments.map((bucket) => (
          <div
            key={bucket}
            data-testid={`status-distribution-segment-${bucket}`}
            className={cn("h-full", BUCKET_TONE[bucket])}
            style={{ width: `${(counts[bucket] / total) * 100}%` }}
          />
        ))}
      </div>

      {/* AS-017: the key — every bucket, always, count as a number AND
          name as text. */}
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {BUCKET_ORDER.map((bucket) => (
          <div key={bucket} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-full", BUCKET_TONE[bucket])}
            />
            <dt className="text-muted-foreground">{CLIENT_BUCKET_LABELS[bucket]}</dt>
            <dd className="font-medium tabular-nums">{counts[bucket]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
