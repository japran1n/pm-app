import { describe, expect, it } from "vitest";
import {
  STACKED_DAYS,
  STACKED_END_HOUR,
  STACKED_START_HOUR,
  clipBlockToStackedWindow,
} from "@/lib/calendar/stacked-window";

describe("stacked window constants", () => {
  it("AS-018: the visible window is 08:00 to 16:00", () => {
    expect(STACKED_START_HOUR).toBe(8);
    expect(STACKED_END_HOUR).toBe(16);
  });

  it("AS-019: the visible days are Monday through Friday only", () => {
    expect(STACKED_DAYS).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("clipBlockToStackedWindow", () => {
  it("AS-020: a block starting before 08:00 is clipped to 08:00 (Wednesday)", () => {
    // 2026-09-23 is a Wednesday (UTC)
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T06:00:00.000Z",
      ends_at: "2026-09-23T10:00:00.000Z",
    });
    expect(result).not.toBeNull();
    expect(result?.starts_at).toBe("2026-09-23T08:00:00.000Z");
    expect(result?.ends_at).toBe("2026-09-23T10:00:00.000Z");
  });

  it("AS-021: a block ending after 16:00 is clipped to 16:00 (Wednesday)", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T14:00:00.000Z",
      ends_at: "2026-09-23T18:00:00.000Z",
    });
    expect(result).not.toBeNull();
    expect(result?.starts_at).toBe("2026-09-23T14:00:00.000Z");
    expect(result?.ends_at).toBe("2026-09-23T16:00:00.000Z");
  });

  it("AS-022: a block entirely outside 08:00-16:00 is dropped (before window)", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T04:00:00.000Z",
      ends_at: "2026-09-23T06:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("AS-022: a block entirely outside 08:00-16:00 is dropped (after window)", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T17:00:00.000Z",
      ends_at: "2026-09-23T19:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("a block on a Saturday returns null", () => {
    // 2026-09-26 is a Saturday (UTC)
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-26T09:00:00.000Z",
      ends_at: "2026-09-26T11:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("a block on a Sunday returns null", () => {
    // 2026-09-27 is a Sunday (UTC)
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-27T09:00:00.000Z",
      ends_at: "2026-09-27T11:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("a block fully inside the window is returned unchanged", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T09:00:00.000Z",
      ends_at: "2026-09-23T11:00:00.000Z",
    });
    expect(result).toEqual({
      starts_at: "2026-09-23T09:00:00.000Z",
      ends_at: "2026-09-23T11:00:00.000Z",
    });
  });

  it("a block starting before 08:00 and ending after 16:00 is clipped on both ends", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T05:00:00.000Z",
      ends_at: "2026-09-23T20:00:00.000Z",
    });
    expect(result).toEqual({
      starts_at: "2026-09-23T08:00:00.000Z",
      ends_at: "2026-09-23T16:00:00.000Z",
    });
  });
});
