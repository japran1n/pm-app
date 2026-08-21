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

import { UserAvatar } from "@/components/user-avatar";
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
}: {
  workspaceSlug: string;
  rows: AuditLogRow[];
  hasMore: boolean;
  /** Full pathname + query string for "load the next bounded window",
   * already computed by the page (current filters + a bumped `limit`). */
  loadMoreHref: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No audit log entries match the current filters.
      </p>
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
