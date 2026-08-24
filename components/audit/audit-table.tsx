// F141: renders a bounded window of workspace audit log entries
// (reverse-chronological) — actor avatar, human-readable sentence, target
// link, timestamp — plus a "Load more" control for the next bounded
// window.
//
// Server Component (no "use client"): every prop is already resolved data
// (rows, hrefs, sentences) and the only "interactive" piece — the "Load
// more" link — is a plain `<a href>` that bumps the URL's `limit` param,
// same round-trip-through-the-URL approach `AuditFilters` uses, so this
// component needs no client-side state or hooks of its own. `UserAvatar`
// is safe to render here for the same reason the members page renders it
// directly (F122's doc comment: no hooks/state of its own).

import Link from "next/link";
import { ScrollText } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  actionSentence,
  targetHref,
  type AuditLogRow,
} from "@/lib/queries/audit";

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function AuditTable({
  workspaceSlug,
  rows,
  hasMore,
  loadMoreHref,
  hasActiveFilters,
}: {
  workspaceSlug: string;
  rows: AuditLogRow[];
  hasMore: boolean;
  /** Full pathname + query string for "load the next bounded window",
   * already computed by the page (current filters + a bumped `limit`). */
  loadMoreHref: string;
  /** F252 (AS-490): whether an actor/action filter is currently applied.
   * Distinguishes "nothing has happened yet" from "nothing matches the
   * current filters" — the page previously showed the same generic "No
   * audit log entries match the current filters" copy even for a
   * workspace with zero audit entries and no filters applied at all. */
  hasActiveFilters: boolean;
}) {
  if (rows.length === 0) {
    return hasActiveFilters ? (
      <EmptyState
        icon={ScrollText}
        title="No matching entries"
        description="No audit log entries match the current filters. Try a different actor or action."
        testId="audit-empty-state-filtered"
      />
    ) : (
      <EmptyState
        icon={ScrollText}
        title="No audit activity yet"
        description="Sensitive actions in this workspace — like role changes and permission updates — will show up here as they happen."
        testId="audit-empty-state-none"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const actorLabel =
                row.actorName || row.actorEmail || row.actorId;
              const sentence = actionSentence({
                action: row.action,
                actorLabel,
                metadata: row.metadata,
              });
              const href = targetHref(workspaceSlug, row);

              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <UserAvatar
                      person={{
                        id: row.actorId,
                        name: row.actorName,
                        email: row.actorEmail,
                        avatarUrl: row.actorAvatarUrl,
                      }}
                      size="sm"
                    />
                  </TableCell>
                  <TableCell>{sentence}</TableCell>
                  <TableCell>
                    {href ? (
                      <Link href={href} className="underline">
                        View
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={row.createdAt}>
                      {formatTimestamp(row.createdAt)}
                    </time>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <Link
          href={loadMoreHref}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "self-start",
          )}
        >
          Load more
        </Link>
      )}
    </div>
  );
}
