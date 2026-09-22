// F011 (SB-043): deterministic colour dot for a sidebar project row.
//
// The palette is the exact set of Tailwind classes
// tests/unit/project-nav-dot-contrast.test.ts already pins as clearing
// 3:1 WCAG AA contrast against both the sidebar's resting background and
// its hover/active (`bg-sidebar-accent`) surface — reusing that vetted
// set here (rather than inventing a new one) means this dot never needs
// its own contrast test in addition to that one.
//
// No hand-written hex value ever reaches a component: this only ever
// returns a Tailwind *class name* from a fixed, already-audited list.
// There's no `client-colour` column on `projects` (checked
// supabase/migrations for one) — colour is derived from the project id,
// not stored.
export const DOT_COLORS = [
  "bg-rose-600",
  "bg-amber-700",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-purple-500",
  "bg-pink-600",
  "bg-teal-600",
  "bg-orange-600",
] as const;

// Simple, stable string hash (djb2) -- deterministic across server and
// client renders (no Math.random, no Date), which matters for hydration:
// the same project id must resolve to the same dot on both passes.
function hashProjectId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 33) ^ id.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function colorForProjectId(id: string): (typeof DOT_COLORS)[number] {
  return DOT_COLORS[hashProjectId(id) % DOT_COLORS.length];
}
