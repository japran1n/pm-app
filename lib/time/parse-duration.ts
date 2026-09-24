// The app's ONE free-text duration parser ("human string in, whole minutes
// out"), the inverse of formatDuration (lib/time/format-duration.ts). Used
// by the global Track Time widget, task estimates (new-task dialog, task
// detail) and architecture discipline estimates, so every duration field
// accepts exactly the same input.
//
// Accepted (case-insensitive, surrounding whitespace ignored):
//   "90"            -> 90   bare number = minutes
//   "2h", "1.5h"    -> 120, 90
//   "20m", "20min"  -> 20
//   "3h 20m", "3h20m", "3h20", "3h 20" -> 200 (minutes unit optional
//                                         after an hours token)
//   "1 hour 30 minutes" -> 90
//   "3:20"          -> 200  clock shape H:MM (optional :SS, rounded)
// Result is rounded to whole minutes.
//
// Rejected (returns null, never throws, never silently drops a part):
//   empty input, zero/negative results, any leftover text ("1h 1h",
//   "2x", "1h30 lunch", "abc"). Callers treat null as "invalid", never 0.

const HOURS_UNIT = "(?:hours|hour|hrs|hr|h)";
const MINUTES_UNIT = "(?:minutes|minute|mins|min|m)";
const NUM = "(\\d+(?:\\.\\d+)?)";

const CLOCK = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/;
const BARE = new RegExp(`^${NUM}$`);
const HOURS_MINUTES = new RegExp(
  `^${NUM}\\s*${HOURS_UNIT}(?:\\s*${NUM}\\s*${MINUTES_UNIT}?)?$`,
);
const MINUTES_ONLY = new RegExp(`^${NUM}\\s*${MINUTES_UNIT}$`);

function positive(total: number): number | null {
  const rounded = Math.round(total);
  return Number.isFinite(rounded) && rounded > 0 ? rounded : null;
}

export function parseDurationToMinutes(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const clock = CLOCK.exec(s);
  if (clock) {
    const seconds = clock[3] ? Number(clock[3]) : 0;
    return positive(Number(clock[1]) * 60 + Number(clock[2]) + seconds / 60);
  }

  const bare = BARE.exec(s);
  if (bare) return positive(Number(bare[1]));

  const hm = HOURS_MINUTES.exec(s);
  if (hm) return positive(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));

  const m = MINUTES_ONLY.exec(s);
  if (m) return positive(Number(m[1]));

  return null;
}
