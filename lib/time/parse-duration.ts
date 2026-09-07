// Global Track Time widget: parses a free-text duration like the input's
// own placeholder example ("3h 20m") into a whole number of minutes, so the
// same text field can either start a timer (empty input) or log a manual
// duration (non-empty input) without a second set of hour/minute inputs.
//
// Accepted shapes (case-insensitive, whitespace-tolerant):
//   "3h 20m", "3h20m", "3h", "20m", "3:20", "200" (bare number = minutes).
// Returns null for anything that doesn't resolve to a positive whole number
// of minutes -- callers treat null as "not a valid duration", never as 0.
export function parseDurationToMinutes(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // "H:MM" or "H:MM:SS" clock shape.
  const clockMatch = trimmed.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (clockMatch) {
    const hours = Number.parseInt(clockMatch[1], 10);
    const minutes = Number.parseInt(clockMatch[2], 10);
    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
  }

  // "3h 20m" / "3h20m" / "3h" / "20m" — hours and/or minutes tokens, in
  // either order, whitespace optional between them.
  const tokenPattern = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)/g;
  let matched = false;
  let totalMinutes = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(trimmed)) !== null) {
    matched = true;
    const value = Number.parseFloat(match[1]);
    const unit = match[2];
    if (unit.startsWith("h")) {
      totalMinutes += value * 60;
    } else {
      totalMinutes += value;
    }
  }
  if (matched) {
    const rounded = Math.round(totalMinutes);
    return rounded > 0 ? rounded : null;
  }

  // Bare number with no unit at all -- treated as minutes (matches the
  // manual log-time form's own plain-minutes input elsewhere in the app).
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const rounded = Math.round(Number.parseFloat(trimmed));
    return rounded > 0 ? rounded : null;
  }

  return null;
}
