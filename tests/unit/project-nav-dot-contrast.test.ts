// F269 (AS-526): components/nav/project-nav-list.tsx's per-project nav
// dot (`colorForProjectId`/`DOT_COLORS`) is a fixed Tailwind class chosen
// deterministically from the project id, rendered directly on the
// sidebar's own background (app/globals.css `--sidebar`). This test
// resolves each class to its Tailwind hex value and checks 3:1 against
// the sidebar background — it caught the original -500 shades (amber-500
// 2.08:1, teal-500 2.41:1, sky-500 2.68:1, emerald-500 2.45:1, orange-500
// 2.71:1 on the sidebar) failing before the fix in this feature.
//
// F338 (M18 scrutiny MAJ-3/FU-G, AS-526): the row is not always plain
// `--sidebar` -- the active/hover row applies `bg-sidebar-accent`
// (project-nav-list.tsx's className), a genuinely different surface the
// dot also renders directly on. This test now additionally checks that
// surface.

import { describe, expect, it } from "vitest";

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const linearize = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const R = linearize(r);
  const G = linearize(g);
  const B = linearize(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA: string, hexB: string): number {
  const L1 = relativeLuminance(hexA);
  const L2 = relativeLuminance(hexB);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Tailwind v4's own -600 hex values (see node_modules/tailwindcss's colour
// table) for the class names project-nav-list.tsx's DOT_COLORS array uses
// — kept as a literal map here (rather than importing Tailwind's palette)
// since this test's job is to pin the ACTUAL rendered hex a future edit to
// DOT_COLORS must be checked against, the same "hardcode the value under
// test" convention lib/task-colors.ts's own contrast test already follows.
const DOT_COLOR_HEX: Record<string, string> = {
  "bg-rose-600": "#e11d48",
  "bg-amber-700": "#b45309",
  "bg-emerald-600": "#059669",
  "bg-sky-600": "#0284c7",
  "bg-purple-500": "#a855f7",
  "bg-pink-600": "#db2777",
  "bg-teal-600": "#0d9488",
  "bg-orange-600": "#ea580c",
};

const SIDEBAR = "#eef0f4"; // app/globals.css :root --sidebar / --gg-gray-100
// F338 (M18 scrutiny MAJ-3/FU-G): the row's real background in its
// active/hover state -- see header comment. --sidebar-accent is now a
// brand-blue tint over white (see app/globals.css).
const SIDEBAR_ACCENT = "#e7eefb"; // color-mix(in srgb, #3670e1 12%, #ffffff)
const AA_UI_COMPONENT_MIN_RATIO = 3;

describe("test_AS_526_project_nav_dots_meet_wcag_aa_contrast", () => {
  it.each(Object.entries(DOT_COLOR_HEX))(
    "%s clears 3:1 against the sidebar background",
    (_className, hex) => {
      expect(contrastRatio(hex, SIDEBAR)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );

  it.each(Object.entries(DOT_COLOR_HEX))(
    "%s clears 3:1 against the sidebar-accent (hover/active row) background",
    (_className, hex) => {
      expect(contrastRatio(hex, SIDEBAR_ACCENT)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );

  it("the previous bg-amber-600 would have FAILED 3:1 on the accent row (regression guard)", () => {
    expect(contrastRatio("#d97706", SIDEBAR_ACCENT)).toBeLessThan(
      AA_UI_COMPONENT_MIN_RATIO,
    );
  });
});
