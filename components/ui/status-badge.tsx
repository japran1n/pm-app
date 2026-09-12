// Shared colour-coded status/priority badge — the same dot+outline treatment
// the Pages table's `StatusPill` (components/portal/status-pill.tsx)
// established for client-facing statuses, generalised so every OTHER static
// (non-editable) status/priority display in the app renders the same visual
// language instead of its own one-off dot-and-text markup: an outlined pill
// with a colour-matched dot (or icon) and label, never colour alone.
//
// This does NOT replace `StatusPill` itself — that component owns portal-
// specific behaviour (the `--status-*` bucket tokens, the description
// tooltip, the "No status" neutral state) that is out of this component's
// scope. `StatusBadge` is the generic building block for callers that only
// have a single colour + label to render: task-card.tsx's priority chip and
// the list view's read-only (viewer-role) priority/status cells.
import type { ComponentType, CSSProperties } from "react";

import { cn } from "@/lib/utils";

export function StatusBadge({
  label,
  color,
  icon: Icon,
  className,
  "data-testid": dataTestId,
}: {
  label: string;
  /** Any valid CSS colour (hex, `var(--...)`, etc). Used for the border,
   * text, dot/icon colour, and a faint tinted background — never the only
   * way the value is conveyed (the label text is always present too). */
  color: string;
  /** When provided, replaces the plain colour dot with an icon (still
   * tinted to `color`) — e.g. a small triangle/eye/check glyph. */
  icon?: ComponentType<{
    className?: string;
    "aria-hidden"?: boolean;
    style?: CSSProperties;
  }>;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <span
      data-testid={dataTestId}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border px-[5.5px] py-[3px] text-[9px] font-medium tracking-[0.07em] uppercase",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3 shrink-0" style={{ color }} /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
