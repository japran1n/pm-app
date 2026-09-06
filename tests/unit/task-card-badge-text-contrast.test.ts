// F269 (AS-526): the "Over estimate" badge (components/task/task-card.tsx
// and components/task/time-tracking.tsx, both F167/AS-301) renders real
// text content on the app's card background, so the 4.5:1 normal-text
// WCAG AA threshold applies (the text is `text-xs`/12px, not bold — the
// 3:1 "large text" exemption needs >=18pt/24px, or >=14pt/18.66px bold).
// The original `text-amber-600` (#d97706) measured only 3.19:1 against
// the card's white ground -- this test pins the fix (`text-amber-700`,
// #b45309).
//
// The progress-bar FILL underneath is a non-text graphical UI component
// (SC 1.4.11, 3:1) against its own `bg-muted` track (app/globals.css).

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

const WHITE_CARD = "#ffffff"; // app/globals.css :root --card
const MUTED_TRACK = "#eef0f4"; // app/globals.css :root --muted / --gg-gray-100

const AA_NORMAL_TEXT_MIN_RATIO = 4.5;
const AA_UI_COMPONENT_MIN_RATIO = 3;

describe("test_AS_526_over_estimate_badge_text_meets_wcag_aa_contrast", () => {
  it("text-amber-700 clears 4.5:1 on the white card", () => {
    expect(contrastRatio("#b45309", WHITE_CARD)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT_MIN_RATIO,
    );
  });

  it("the previous text-amber-600 would have FAILED 4.5:1 on the white card (regression guard)", () => {
    expect(contrastRatio("#d97706", WHITE_CARD)).toBeLessThan(
      AA_NORMAL_TEXT_MIN_RATIO,
    );
  });
});

describe("test_AS_526_over_estimate_progress_fill_meets_wcag_aa_contrast", () => {
  it("bg-amber-700 (fill) clears 3:1 on the muted track", () => {
    expect(contrastRatio("#b45309", MUTED_TRACK)).toBeGreaterThanOrEqual(
      AA_UI_COMPONENT_MIN_RATIO,
    );
  });

  it("the previous bg-amber-500 would have FAILED 3:1 on the muted track (regression guard)", () => {
    expect(contrastRatio("#f59e0b", MUTED_TRACK)).toBeLessThan(
      AA_UI_COMPONENT_MIN_RATIO,
    );
  });
});
