import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALENDAR_BLOCK_COLOR,
  getCalendarBlockDisplayColor,
} from "@/lib/calendar/block-colors";

describe("getCalendarBlockDisplayColor", () => {
  it("returns the block's own color when it is a known swatch", () => {
    expect(getCalendarBlockDisplayColor("#ef4444")).toBe("#ef4444");
  });

  it("falls back to the default swatch for a null color (legacy block)", () => {
    expect(getCalendarBlockDisplayColor(null)).toBe(DEFAULT_CALENDAR_BLOCK_COLOR);
  });

  it("falls back to the default swatch for an undefined color", () => {
    expect(getCalendarBlockDisplayColor(undefined)).toBe(DEFAULT_CALENDAR_BLOCK_COLOR);
  });

  it("falls back to the default swatch for an unrecognized value", () => {
    expect(getCalendarBlockDisplayColor("#not-a-real-swatch")).toBe(
      DEFAULT_CALENDAR_BLOCK_COLOR,
    );
  });
});
