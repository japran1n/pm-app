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
// dependency and no second source of truth" resolution. AS-526 (dark-theme
// contrast) is a separate assertion owned by a different feature; this
// palette gives that feature a single, small, already-partially-vetted set
// to finish checking rather than an unbounded colour space.

export type ColumnColorOption = {
  value: string;
  label: string;
};

export const COLUMN_COLOR_PALETTE: ColumnColorOption[] = [
  { value: "#64748b", label: "Slate" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#d97706", label: "Amber" },
  { value: "#16a34a", label: "Green" },
  { value: "#ef4444", label: "Red" },
  { value: "#ea580c", label: "Orange" },
  { value: "#a16207", label: "Yellow" },
  { value: "#475569", label: "Slate (dark)" },
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
