// F219 (AS-405, and the Clarified implementation's answer to the "colour
// choices must satisfy contrast in both themes (AS-526)" open question):
// the column colour picker is constrained to this fixed palette rather than
// a free colour input, so it can never produce a colour AS-526's contrast
// requirement hasn't already vetted.
//
// No new contrast computation is introduced here — every hex value below
// is one already checked for >=3:1 contrast on a light background by F087
// (AS-154) in lib/task-colors.ts (see tests/unit/task-colors-contrast.test.ts)
// and reused verbatim, per this feature's "simpler option that adds no new
// dependency and no second source of truth" resolution. F269 (AS-526)
// finished the dark-theme half of that check and swapped the one entry
// that failed it — see the palette's own comment below.

export type ColumnColorOption = {
  value: string;
  label: string;
};

// F269 (AS-526): "Slate (dark)" (#475569, slate-600) was reused verbatim
// from lib/task-colors.ts per this file's own header comment, but F269
// found it fails 3:1 against the DARK theme's own column background
// (bg-muted/30 over oklch(0.205 0 0), same surface board-column.tsx
// renders this dot on) at 2.18:1 — every OTHER entry here already cleared
// 3:1 on both light and dark. Swapped for zinc-500 (#71717a, 4.83:1 on
// white / 3.41:1 on dark), the same replacement lib/task-colors.ts's
// PRIORITY_COLORS.backlog now uses, so the two "neutral/no-emphasis"
// swatches across the app stay visually consistent with each other.
export const COLUMN_COLOR_PALETTE: ColumnColorOption[] = [
  { value: "#64748b", label: "Slate" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#d97706", label: "Amber" },
  { value: "#16a34a", label: "Green" },
  { value: "#ef4444", label: "Red" },
  { value: "#ea580c", label: "Orange" },
  { value: "#a16207", label: "Yellow" },
  { value: "#71717a", label: "Zinc" },
];

export const DEFAULT_COLUMN_COLOR = COLUMN_COLOR_PALETTE[0].value;

export function isApprovedColumnColor(value: string): boolean {
  return COLUMN_COLOR_PALETTE.some((option) => option.value === value);
}

export type ColumnCategory = "not_started" | "in_progress" | "done";

export const COLUMN_CATEGORIES: { value: ColumnCategory; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export function isColumnCategory(value: string): value is ColumnCategory {
  return value === "not_started" || value === "in_progress" || value === "done";
}
