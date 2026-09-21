import { Badge } from "@/components/ui/badge";

export interface BriefHeaderProps {
  answeredCount: number;
  totalCount: number;
  requiredMissingCount: number;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
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
}: BriefHeaderProps) {
  const percent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

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
          <Badge variant="warning">{requiredMissingCount} required missing</Badge>
        ) : (
          <Badge variant="default">Complete</Badge>
        )}
      </div>
      {lastModifiedAt ? (
        <p className="text-sm text-muted-foreground">
          Last updated by <span className="font-mono">{lastModifiedBy ?? "Someone"}</span> ·{" "}
          <span className="font-mono">{dateFormatter.format(new Date(lastModifiedAt))}</span>
        </p>
      ) : null}
    </header>
  );
}
