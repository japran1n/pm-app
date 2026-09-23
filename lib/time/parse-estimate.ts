// F166 (AS-298, AS-299): pure "human duration string" -> minutes parser,
// the inverse of formatDuration (lib/time/format-duration.ts) — kept as a
// standalone, unit-testable function so the edit action/Zod schema and any
// future estimate-entry UI never diverge on what counts as a valid
// estimate.
//
// Accepted formats (case-insensitive, surrounding whitespace ignored):
//   "2h"        -> 120
//   "90m"       -> 90
//   "1h 30m"    -> 90   (hours segment optionally followed by a minutes
//                         segment, separated by whitespace)
//   "1h30m"     -> 90   (no space also accepted)
//   plain integer strings, e.g. "45"  -> 45 (bare minutes, no unit)
//
// Rejected (returns null, never throws):
//   - empty/whitespace-only input
//   - zero or negative results ("0h", "-5m", "0") — AS-299
//   - unparseable garbage ("abc", "2x", "1h 1h") — no silent fallback to 0
//     or NaN; the caller (Zod schema) must be able to tell "invalid input"
//     from "no estimate" apart from an explicit null/empty field.
//   - fractional hours/minutes ("1.5h") — this mission's minutes columns
//     are plain integers (matching time_entries.minutes' convention), so
//     the parser only accepts whole-number components.
export function parseEstimate(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;

  // Bare integer minutes, e.g. "45".
  if (/^\d+$/.test(trimmed)) {
    const minutes = Number.parseInt(trimmed, 10);
    return minutes > 0 ? minutes : null;
  }

  // "<hours>h" optionally followed by whitespace and "<minutes>m".
  const match = /^(?:(\d+)\s*(?:hr|h))?\s*(?:(\d+)\s*(?:min|m))?$/.exec(trimmed);
  if (!match) return null;

  const [, hoursPart, minutesPart] = match;
  if (hoursPart === undefined && minutesPart === undefined) return null;

  const hours = hoursPart ? Number.parseInt(hoursPart, 10) : 0;
  const minutes = minutesPart ? Number.parseInt(minutesPart, 10) : 0;
  const total = hours * 60 + minutes;

  return total > 0 ? total : null;
}
