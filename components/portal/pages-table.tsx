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
import { FileQuestion } from "lucide-react";
import type { PortalPage } from "@/lib/queries/portal";
import type { ClientBucket } from "@/components/portal/status-label";

const ALL_STATUSES = "__all__";

const FILTER_LABELS: Record<ClientBucket, string> = {
  waiting: "Waiting on you",
  progress: "In progress",
  blocked: "Blocked",
  done: "Ready to launch",
};

const FILTER_ORDER: ClientBucket[] = ["waiting", "progress", "blocked", "done"];

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PagesTable({ pages }: { pages: PortalPage[] }) {
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
            <SelectValue />
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPages.map((page) => (
              <TableRow key={page.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{page.title}</span>
                    {page.slug && (
                      <span className="font-mono text-xs text-muted-foreground">
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
                        <span className="text-sm">
                          {page.assignee.name ?? "Someone at the agency"}
                        </span>
                        {page.assignee.roleLabel && (
                          <span className="text-xs text-muted-foreground">
                            {page.assignee.roleLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatUpdatedAt(page.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
