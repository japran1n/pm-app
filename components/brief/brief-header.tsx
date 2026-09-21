import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

export interface BriefHeaderProps {
  answeredCount: number;
  totalCount: number;
  requiredMissingCount: number;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
  /** BR-025: inline content appended to the meta line (e.g. notification recipients). */
  meta?: ReactNode;
  /** BR-023: action buttons rendered directly under the header. */
  actions?: ReactNode;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function BriefHeader({
  answeredCount,
  totalCount,
  requiredMissingCount,
  lastModifiedBy,
  lastModifiedAt,
  meta,
  actions,
}: BriefHeaderProps) {
  const percent =
    totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

  return (
    <header className="mb-6 space-y-2">
      <h1 className="text-lg font-semibold text-foreground">Brief</h1>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-muted-foreground">
          {answeredCount}/{totalCount}
        </span>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={answeredCount}
          className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        {requiredMissingCount > 0 ? (
          <Badge variant="warning">
            {requiredMissingCount} required missing
          </Badge>
        ) : (
          <Badge variant="success">Complete</Badge>
        )}
      </div>
      {lastModifiedAt || meta ? (
        <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          {lastModifiedAt ? (
            <>
              <span>
                Last updated by{" "}
                <span>{lastModifiedBy ?? "Someone"}</span>{" "}
                ·{" "}
                <span className="font-mono">
                  {dateFormatter.format(new Date(lastModifiedAt))}
                </span>
              </span>
            </>
          ) : null}
          {lastModifiedAt && meta ? <span aria-hidden="true">·</span> : null}
          {meta}
        </p>
      ) : null}
      {actions ? (
        <div
          data-testid="brief-header-actions"
          className="flex flex-wrap items-center gap-2 pt-1"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
