// F269 (AS-525, AS-526): the F219 board-column colour picker
// (lib/board/column-colors.ts's COLUMN_COLOR_PALETTE) is a fixed, curated
// palette rather than a free hex input specifically so it can never offer
// a colour AS-526's contrast requirement hasn't already vetted (per this
// feature's clarified "the picker must only offer AA-safe values, which
// is a design constraint, not a runtime check" resolution). This test
// enforces that design constraint against the app's single light theme's
// white column background (the board column renders this dot directly on
// `bg-muted/30` layered over `--card`).

import { describe, expect, it } from "vitest";

import { COLUMN_COLOR_PALETTE, isApprovedColumnColor } from "@/lib/board/column-colors";

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
const AA_UI_COMPONENT_MIN_RATIO = 3;

describe("test_AS_526_column_color_palette_meets_wcag_aa_contrast", () => {
  it.each(COLUMN_COLOR_PALETTE)(
    "$label ($value) clears 3:1 against a white column background",
    ({ value }) => {
      expect(contrastRatio(value, WHITE)).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT_MIN_RATIO,
      );
    },
  );
});

describe("test_AS_525_column_color_picker_offers_only_the_approved_palette", () => {
  it("rejects a colour outside the approved palette (no free hex input)", () => {
    expect(isApprovedColumnColor("#123456")).toBe(false);
  });

  it("accepts every colour the palette itself offers", () => {
    for (const option of COLUMN_COLOR_PALETTE) {
      expect(isApprovedColumnColor(option.value)).toBe(true);
    }
  });
});
