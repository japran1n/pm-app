// F166 (AS-298, AS-299): task estimates use the app's single duration
// parser (lib/time/parse-duration.ts). This alias only keeps the name
// existing callers import.
export { parseDurationToMinutes as parseEstimate } from "@/lib/time/parse-duration";
