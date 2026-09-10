// F188 (AS-343, AS-347): the read-only list of deleted tasks/comments
// rendered by the trash page. A plain Server Component (no interaction of
// its own — the type filter lives in the sibling client `TrashFilters`
// component, per this feature's Clarified "Client Component only for
// interaction" answer); this stays a pure presentational function so it
// can be unit-tested without any client-runtime setup.

import { FileText, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { TrashItem } from "@/lib/queries/trash";
import { RestoreCommentButton } from "@/components/trash/restore-comment-button";
import { TrashRestoreButton } from "@/components/trash/trash-restore-button";
import { PurgeDialog } from "@/components/trash/purge-dialog";

export function trashItemDateLabel(
  isoDate: string,
  formatter: Intl.DateTimeFormat,
): string {
  return formatter.format(new Date(isoDate));
}

export function TrashList({
  items,
  dateFormatter,
  canPurge = false,
}: {
  items: TrashItem[];
  dateFormatter: Intl.DateTimeFormat;
  // F192 (AS-348): only a workspace owner sees the permanent-delete
  // control — the real enforcement boundary is purgeTrashItem's own
  // server-side `canPurge` re-check (lib/actions/purge.ts), this prop
  // only controls whether the button renders at all. Defaults to false
  // so every existing call site (and this component's own unit tests,
  // F188/F189) that doesn't pass it keeps its prior behaviour unchanged.
  canPurge?: boolean;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {items.map((item) => (
        <li
          key={`${item.type}-${item.id}`}
          className="flex items-start gap-3 p-4 hover:bg-muted/50"
        >
          <div
            aria-hidden="true"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"
          >
            {item.type === "task" ? (
              <FileText className="size-4 text-muted-foreground" />
            ) : (
              <MessageSquare className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {item.type === "task" ? "Task" : "Comment"}
              </Badge>
              {item.taskKey && (
                <span className="font-mono text-xs text-muted-foreground">
                  {item.taskKey}
                </span>
              )}
              <span className="truncate text-sm font-medium">
                {item.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              From {item.projectName} — deleted{" "}
              <span className="font-mono">
                {trashItemDateLabel(item.deletedAt, dateFormatter)}
              </span>
              {item.deletedByName ? ` by ${item.deletedByName}` : ""}
            </p>
          </div>
          {/* F189 (AS-344, AS-351) restores a task; F191 (AS-346)
              restores a comment — each row gets the control for its own
              type, wired to its own Server Action. */}
          <div className="flex shrink-0 items-center gap-2">
            {item.type === "task" && <TrashRestoreButton taskId={item.id} />}
            {item.type === "comment" && (
              <RestoreCommentButton commentId={item.id} />
            )}
            {canPurge && (
              <PurgeDialog
                itemId={item.id}
                itemType={item.type}
                itemLabel={item.label}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
