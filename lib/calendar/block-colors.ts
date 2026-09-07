// Planner feature: the fixed, predefined color swatch set a member picks
// from for a calendar block (ClickUp/Google-Calendar-style "assign a
// color" affordance) -- deliberately a small closed set of swatches, not
// a full custom color picker, per this feature's own clarified answer.
// Persisted verbatim (the hex value itself) into `calendar_blocks.color`
// (see supabase/migrations/20261107010000_calendar_blocks.sql), and
// applied to both the block chip's background AND its left border so a
// color reads clearly even at the smallest chip heights this view renders
// (15-minute-tall blocks).
//
// Values chosen from the same Tailwind palette lib/task-colors.ts already
// uses elsewhere in the app (500-weight, single light theme -- see the
// "collapse app to a single light theme" commit), so a block's color
// reads consistently with the rest of the app's own color language
// instead of introducing a second, unrelated palette.

export type CalendarBlockColor = {
  /** Stored verbatim in `calendar_blocks.color`. */
  value: string;
  /** Accessible name for the swatch button. */
  label: string;
};

export const CALENDAR_BLOCK_COLORS: CalendarBlockColor[] = [
  { value: "#3b82f6", label: "Blue" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#ec4899", label: "Pink" },
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#64748b", label: "Slate" },
];

export const DEFAULT_CALENDAR_BLOCK_COLOR = CALENDAR_BLOCK_COLORS[0]!.value;

/** True for any value in the fixed swatch set -- everything else (a
 * legacy null/unset block, or a value that somehow doesn't match) falls
 * back to the chip's own default dashed-primary styling rather than
 * failing to render. */
export function isKnownCalendarBlockColor(value: string | null | undefined): value is string {
  if (!value) return false;
  return CALENDAR_BLOCK_COLORS.some((c) => c.value === value);
}
