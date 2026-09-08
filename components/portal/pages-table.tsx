"use client";

// F005 (missions/20260903-portal, AS-016, AS-018): the Pages view's own
// table + status filter. Client Component receiving typed props from the
// Server Component page (lib/queries/portal.ts's `getPortalPages`) —
// this component never queries Supabase itself (tech-decisions.md's
// Server-Components-fetch convention).
//
// AS-018: the status filter is pure client-side `useState` + `.filter()`
// over the already-fetched `pages` prop — choosing a filter never issues
// a network request or reloads the page.

import { useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { StatusPill } from "@/components/portal/status-pill";
import { PageLinksMenu } from "@/components/portal/page-links-menu";
import { FileQuestion } from "lucide-react";
import type { PortalPage } from "@/lib/queries/portal";
import type { PageLink } from "@/lib/queries/page-links";
import { CLIENT_BUCKET_LABELS, type ClientBucket } from "@/components/portal/status-label";

const ALL_STATUSES = "__all__";

// F006g (missions/20260903-portal, AS-015): the filter's own labels used
// to be a third, locally-owned copy of the bucket -> name map (alongside
// status-distribution.tsx's key and status-manager.tsx's override
// select) -- reads `CLIENT_BUCKET_LABELS` (status-label.ts) instead so
// there is exactly one file a bucket's client-facing name can be edited
// in.
const FILTER_LABELS = CLIENT_BUCKET_LABELS;

const FILTER_ORDER: ClientBucket[] = ["waiting", "progress", "blocked", "done"];

// F108 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.2,
// coordinator review): the sentinel-to-label map for the filter
// dropdown's own trigger. Base UI's `Select.Value` (components/ui/select.tsx)
// only mirrors a matching `Select.Item`'s rendered text once the popup has
// been opened at least once -- before that, its default render is the raw
// `value` itself, which is how "__all__" (the sentinel, never meant to be
// read) was reaching the client verbatim on first paint. Passing an
// explicit children function (Base UI's own documented escape hatch) means
// the trigger always shows a real label, opened or not.
const FILTER_TRIGGER_LABELS: Record<string, string> = {
  [ALL_STATUSES]: "All statuses",
  ...CLIENT_BUCKET_LABELS,
};

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PagesTable({
  pages,
  linksByPageId,
}: {
  pages: PortalPage[];
  // F113 (client-portal-phase-2-plan.md item B): each page's own
  // client-visible links (Figma/staging/live), keyed by task id. Optional
  // so this component's own existing unit tests (which construct
  // `PortalPage[]` without this prop) keep passing unchanged --
  // `linksByPageId?.get(...) ?? []` below treats "prop omitted" exactly
  // like "no links for this page", never a crash.
  linksByPageId?: Map<string, PageLink[]>;
}) {
  const [filter, setFilter] = useState<string>(ALL_STATUSES);

  const filteredPages =
    filter === ALL_STATUSES
      ? pages
      : pages.filter((page) => page.status.clientBucket === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(value) => setFilter(value ?? ALL_STATUSES)}>
          <SelectTrigger id="pages-status-filter" className="w-56" aria-label="Filter by status">
            <SelectValue>
              {(value: string | null) => FILTER_TRIGGER_LABELS[value ?? ALL_STATUSES] ?? "All statuses"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            {FILTER_ORDER.map((bucket) => (
              <SelectItem key={bucket} value={bucket}>
                {FILTER_LABELS[bucket]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredPages.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title="No pages match this filter."
          description="Choose a different status, or clear the filter to see every page."
          testId="pages-table-empty"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Who has it</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Links</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPages.map((page) => (
              <TableRow key={page.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{page.title}</span>
                    {page.slug && (
                      <span className="font-mono text-micro text-muted-foreground">
                        /{page.slug.replace(/^\//, "")}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill
                    name={page.status.name}
                    category={page.status.category}
                    clientBucket={page.status.clientBucket}
                    description={page.status.clientDescription}
                    // F108 (coordinator review): the pipeline above this
                    // table already speaks the client's own four-bucket
                    // vocabulary (status-label.ts) -- this column used to
                    // render the status's raw internal `name` instead
                    // (the default seed literally names statuses
                    // `todo`/`in_progress`/`in_review`/`done`), reading
                    // as a bug directly beneath the component that gets
                    // it right. `page.status.clientBucket` is the exact
                    // resolved bucket every other client-facing surface
                    // on this page already reads -- never a second,
                    // locally recomputed one.
                    labelOverride={
                      page.status.name === null ? null : CLIENT_BUCKET_LABELS[page.status.clientBucket]
                    }
                  />
                </TableCell>
                <TableCell>
                  {page.assignee ? (
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        person={{
                          id: page.assignee.id,
                          name: page.assignee.name,
                          avatarUrl: page.assignee.avatarUrl,
                        }}
                        size="sm"
                      />
                      <div className="flex flex-col leading-tight">
                        <span className="text-mini">
                          {page.assignee.name ?? "Someone at the agency"}
                        </span>
                        {page.assignee.roleLabel && (
                          <span className="text-micro text-muted-foreground">
                            {page.assignee.roleLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-mini text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
                <TableCell className="text-mini text-muted-foreground">
                  {formatUpdatedAt(page.updatedAt)}
                </TableCell>
                <TableCell>
                  <PageLinksMenu links={linksByPageId?.get(page.id) ?? []} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
