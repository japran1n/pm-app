// F122 (AS-204): deterministic user-id -> colour mapping, shared by every
// initials avatar in the app today and by F224's swimlane/grouping colours
// later (per this feature's own Notes for clarification: "The palette must
// be shared with swimlane/grouping colours later — keep it in one
// module"). Kept dependency-free and with NO React import so it stays
// usable from anywhere a user id string is available — a Server Component,
// a Client Component, a non-UI grouping helper — not just from
// components/user-avatar.tsx.
//
// Colour choice: fixed hex background/foreground pairs, not derived from
// the app's `--background`/`--foreground` theme tokens (app/globals.css).
// This mirrors the precedent already set by lib/task-colors.ts (F073/F087,
// AS-154) — STATUS_COLORS/PRIORITY_COLORS are also plain hardcoded hex so
// they read identically as inline `style` values and Recharts `fill`
// props. Because each pair here is fixed regardless of the app's light/
// dark toggle, its contrast ratio is constant — computed once and
// verified >=4.5:1 (WCAG AA, normal-size text — the initials are small,
// so the 3:1 "large text"/graphical-object threshold does not apply) for
// EVERY pair in tests/unit/user-color.test.ts. That is what "meets WCAG AA
// in both light and dark themes" means for a swatch that does not itself
// change between themes: the check holds unconditionally, not per-theme.

export type AvatarPaletteEntry = {
  /** Human-readable name, for debugging/tests only — never rendered. */
  name: string;
  /** Swatch background, used as the avatar fallback's fill colour. */
  background: string;
  /** Initials text colour on top of `background`. */
  foreground: string;
};

// Verified via tests/unit/user-color.test.ts: every (background,
// foreground) pair below clears a 4.5:1 WCAG AA contrast ratio.
export const AVATAR_PALETTE: readonly AvatarPaletteEntry[] = [
  { name: "red", background: "#dc2626", foreground: "#ffffff" }, // 4.83:1
  { name: "orange", background: "#ea580c", foreground: "#0f172a" }, // 5.02:1
  { name: "amber", background: "#b45309", foreground: "#ffffff" }, // 5.02:1
  { name: "green", background: "#16a34a", foreground: "#0f172a" }, // 5.42:1
  { name: "teal", background: "#0d9488", foreground: "#0f172a" }, // 4.77:1
  { name: "blue", background: "#2563eb", foreground: "#ffffff" }, // 5.17:1
  { name: "indigo", background: "#4f46e5", foreground: "#ffffff" }, // 6.29:1
  { name: "fuchsia", background: "#c026d3", foreground: "#ffffff" }, // 4.71:1
] as const;

// djb2 string hash — small, pure, dependency-free, and stable across
// platforms/Node versions (unlike relying on a `Map`/`Set` iteration order
// or a non-deterministic hashing API). Only used to pick a palette bucket,
// never for anything security-sensitive, so collision resistance beyond
// "looks well distributed across 8 buckets" is not a requirement.
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  // `>>> 0` coerces the possibly-negative 32-bit result to an unsigned
  // integer before the modulo below, so the index is always in range.
  return hash >>> 0;
}

/**
 * AS-204: deterministic index into `AVATAR_PALETTE` for a given user id —
 * the same id always yields the same index, so the same person always
 * gets the same colour everywhere they're rendered.
 */
export function userColorIndex(userId: string): number {
  return hashString(userId) % AVATAR_PALETTE.length;
}

/** AS-204: the full background/foreground pair for a given user id. */
export function getUserColor(userId: string): AvatarPaletteEntry {
  return AVATAR_PALETTE[userColorIndex(userId)];
}
