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
  variant = "tint",
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
  /** Ad-hoc status redesign (2026-09-12): opt-in "solid" reading for the
   * List view's status pill (ClickUp-style strong colour fill) without
   * touching the default 10%-tint look every other caller (priority chip,
   * portal status displays, etc.) already relies on. Darkens the fill via
   * `color-mix` toward black rather than switching palette so the
   * lighter/grey statuses (e.g. #64748b) stay legible with white text in
   * light mode too. */
  variant?: "tint" | "solid";
  "data-testid"?: string;
}) {
  const isSolid = variant === "solid";
  return (
    <span
      data-testid={dataTestId}
      style={
        isSolid
          ? {
              color: "color-mix(in srgb, white 96%, black)",
              borderColor: `color-mix(in srgb, ${color} 88%, black)`,
              backgroundColor: `color-mix(in srgb, ${color} 88%, black)`,
            }
          : {
              color,
              borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
            }
      }
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border font-medium tracking-[0.07em] uppercase",
        isSolid ? "px-2 py-[3px] text-[10px]" : "px-[5.5px] py-[3px] text-[9px]",
        className,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden
          className="size-3 shrink-0"
          style={isSolid ? { color: "inherit" } : { color }}
        />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
