import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// F252 (AS-490): a single shared empty-state building block ("icon,
// headline, one sentence, primary action") so surfaces added or touched
// by this feature stop hand-rolling the same three-`<div>` markup that
// components/board/board-empty-state.tsx, the archive/templates/trash
// pages, etc. already used inline (those pre-existing, already-purposeful
// empty states are left as-is per this feature's clarified "don't
// regress or duplicate" note — this component is for the gap this
// feature actually found and fixed, and is available for future
// surfaces).
//
// Server Component: purely presentational, no state/hooks of its own —
// callers that need an interactive primary action (e.g. a dialog trigger)
// pass a client child as `action`, exactly like BoardEmptyState already
// does with <NewTaskDialog>.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Primary action, e.g. a "Create task" button/dialog trigger. Omitted
   * entirely (not rendered disabled) when the caller has no action to
   * offer — e.g. a permission-limited viewer, or a "no matches" variant
   * whose action is "clear filters" and lives in the caller's own filter
   * bar rather than here. */
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={
        className ??
        "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center"
      }
    >
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-muted"
      >
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-mini font-medium">{title}</p>
        <p className="text-mini text-muted-foreground">{description}</p>
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
