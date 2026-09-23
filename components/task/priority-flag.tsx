// F004 (TT-006): one shared flag-shaped priority indicator so every
// surface (task cards, detail sheet, select rows) renders priority
// consistently instead of each place inventing its own icon/color.
// Color comes from lib/task-colors.ts's PRIORITY_COLORS — the single
// source of truth for priority color coding (see that file's header
// comment, F073/AS-135) — never a locally hand-picked hex.
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";

export type PriorityFlagPriority = keyof typeof PRIORITY_COLORS | null;

const FLAG_PATH = "M4 22V3M4 4h14l-2.5 4.5L18 13H4";

export function PriorityFlag({
  priority,
  size = 14,
}: {
  priority: PriorityFlagPriority;
  size?: number;
}) {
  const isNone = priority == null || priority === "none";
  const label = isNone
    ? PRIORITY_LABELS.none
    : PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill={isNone ? "none" : PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS]}
      stroke={isNone ? "currentColor" : "none"}
      strokeWidth={isNone ? 1.5 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      className={isNone ? "text-muted-foreground" : undefined}
    >
      <path d={FLAG_PATH} />
    </svg>
  );
}
