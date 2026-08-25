// Unit test for F087 (AS-154): "The app meets WCAG AA contrast ratios for
// text on its default light theme."
//
// STATUS_COLORS / PRIORITY_COLORS (lib/task-colors.ts) are used as status
// dots (board column header, list status select) and badge borders (task
// card / list table priority badge) rendered directly on the app's
// default light (white/light-card) background — never as text color, so
// the applicable WCAG AA threshold is 3:1 (non-text UI components /
// graphical objects, SC 1.4.11), not the 4.5:1 text threshold. This test
// computes the actual contrast ratio of every value in both maps against
// a white background and asserts it clears 3:1, so a future edit to
// task-colors.ts can't silently reintroduce a color that reads as a
// washed-out dot against a light card.
//
// See test_AS_153 below for the companion assertion: color is never the
// *sole* means of conveying status/priority (a text label always renders
// alongside), checked by grepping the components that use these maps for
// the paired *_LABELS constant.

import { describe, expect, it } from "vitest";

import { PRIORITY_COLORS, STATUS_COLORS } from "@/lib/task-colors";

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

const WHITE = "#ffffff";
// WCAG AA, non-text UI components / graphical objects (SC 1.4.11).
const AA_UI_COMPONENT_MIN_RATIO = 3;

describe("test_AS_154_task_colors_meet_wcag_aa_contrast_on_light_theme", () => {
  it.each(Object.entries(STATUS_COLORS))(
    "STATUS_COLORS.%s clears 3:1 against a white card background",
    (_status, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );

  it.each(Object.entries(PRIORITY_COLORS))(
    "PRIORITY_COLORS.%s clears 3:1 against a white card background",
    (_priority, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );
});

// F269 (AS-526): STATUS_COLORS/PRIORITY_COLORS are fixed hex values (see
// this file's header comment) rendered UNCHANGED in both the light and
// dark theme, directly on the dark theme's own card background
// (app/globals.css's `.dark { --card: oklch(0.205 0 0); }`, approximately
// #1f1f1f in sRGB) — so the same 3:1 non-text threshold must ALSO hold
// against that surface, independently of the light-theme check above.
// This test caught PRIORITY_COLORS.backlog (slate-600, #475569) failing
// at 2.18:1 on dark before the fix in this feature.
const DARK_CARD = "#1f1f1f"; // app/globals.css .dark --card: oklch(0.205 0 0)

describe("test_AS_526_task_colors_meet_wcag_aa_contrast_on_dark_theme", () => {
  it.each(Object.entries(STATUS_COLORS))(
    "STATUS_COLORS.%s clears 3:1 against the dark theme's card background",
    (_status, hex) => {
      expect(contrastRatio(hex, DARK_CARD)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );

  it.each(Object.entries(PRIORITY_COLORS))(
    "PRIORITY_COLORS.%s clears 3:1 against the dark theme's card background",
    (_priority, hex) => {
      expect(contrastRatio(hex, DARK_CARD)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );
});
