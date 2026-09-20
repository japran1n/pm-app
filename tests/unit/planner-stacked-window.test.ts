import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  it("AS-022: a block starting before 08:00 is clipped to 08:00 (Wednesday)", () => {
    // 2026-09-23 is a Wednesday (UTC)
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T06:00:00.000Z",
      ends_at: "2026-09-23T10:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-23T08:00:00.000Z",
        ends_at: "2026-09-23T10:00:00.000Z",
      },
    ]);
  });

  it("AS-022: a block ending after 16:00 is clipped to 16:00 (Wednesday)", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T14:00:00.000Z",
      ends_at: "2026-09-23T18:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-23T14:00:00.000Z",
        ends_at: "2026-09-23T16:00:00.000Z",
      },
    ]);
  });

  it("AS-020: a block entirely before 08:00 returns empty", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T04:00:00.000Z",
      ends_at: "2026-09-23T06:00:00.000Z",
    });
    expect(result).toEqual([]);
  });

  it("AS-020: a block entirely after 16:00 returns empty", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T17:00:00.000Z",
      ends_at: "2026-09-23T19:00:00.000Z",
    });
    expect(result).toEqual([]);
  });

  it("AS-021: block on Saturday/Sunday is excluded (Saturday)", () => {
    // 2026-09-26 is a Saturday (UTC)
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-26T09:00:00.000Z",
      ends_at: "2026-09-26T11:00:00.000Z",
    });
    expect(result).toEqual([]);
  });

  it("AS-021: block on Saturday/Sunday is excluded (Sunday)", () => {
    // 2026-09-27 is a Sunday (UTC)
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-27T09:00:00.000Z",
      ends_at: "2026-09-27T11:00:00.000Z",
    });
    expect(result).toEqual([]);
  });

  it("a block fully inside the window is returned unchanged as a single segment", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T09:00:00.000Z",
      ends_at: "2026-09-23T11:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-23T09:00:00.000Z",
        ends_at: "2026-09-23T11:00:00.000Z",
      },
    ]);
  });

  it("a block starting before 08:00 and ending after 16:00 is clipped on both ends", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-23T05:00:00.000Z",
      ends_at: "2026-09-23T20:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-23T08:00:00.000Z",
        ends_at: "2026-09-23T16:00:00.000Z",
      },
    ]);
  });

  it("Sun 22:00Z -> Mon 10:00Z produces one segment on Monday, clipped to 08:00", () => {
    // 2026-09-27 is Sunday, 2026-09-28 is Monday
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-27T22:00:00.000Z",
      ends_at: "2026-09-28T10:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-28T08:00:00.000Z",
        ends_at: "2026-09-28T10:00:00.000Z",
      },
    ]);
  });

  it("Mon 09:00Z -> Fri 15:00Z produces 5 daily segments, Mon-Fri", () => {
    // 2026-09-28 Mon .. 2026-10-02 Fri
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-28T09:00:00.000Z",
      ends_at: "2026-10-02T15:00:00.000Z",
    });
    expect(result).toEqual([
      { starts_at: "2026-09-28T09:00:00.000Z", ends_at: "2026-09-28T16:00:00.000Z" },
      { starts_at: "2026-09-29T08:00:00.000Z", ends_at: "2026-09-29T16:00:00.000Z" },
      { starts_at: "2026-09-30T08:00:00.000Z", ends_at: "2026-09-30T16:00:00.000Z" },
      { starts_at: "2026-10-01T08:00:00.000Z", ends_at: "2026-10-01T16:00:00.000Z" },
      { starts_at: "2026-10-02T08:00:00.000Z", ends_at: "2026-10-02T15:00:00.000Z" },
    ]);
  });

  it("Fri 15:00Z -> Sat 09:00Z produces one segment on Friday only", () => {
    // 2026-10-02 Fri, 2026-10-03 Sat
    const result = clipBlockToStackedWindow({
      starts_at: "2026-10-02T15:00:00.000Z",
      ends_at: "2026-10-03T09:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-10-02T15:00:00.000Z",
        ends_at: "2026-10-02T16:00:00.000Z",
      },
    ]);
  });

  it("Mon 08:00Z -> Mon 16:00Z (exact boundary) produces one full-window segment", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-28T08:00:00.000Z",
      ends_at: "2026-09-28T16:00:00.000Z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-28T08:00:00.000Z",
        ends_at: "2026-09-28T16:00:00.000Z",
      },
    ]);
  });
});

describe("toUtcMs offset handling (AS-022 regression: PostgREST timestamptz)", () => {
  // These fixtures reproduce the bug where the previous regex
  // `[Z+\-]\d*$` could not match a colon-delimited numeric offset
  // (e.g. "+00:00"), so every block coming back from Supabase/PostgREST
  // silently produced an empty array instead of being rendered.
  // Mutation check: if clipBlockToStackedWindow were stubbed to always
  // return `[]`, every `toEqual` below with a non-empty array would fail.

  it("AS-022: PostgREST canonical +00:00 offset (Monday) is not dropped", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-22T09:00:00+00:00",
      ends_at: "2026-09-22T10:00:00+00:00",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-22T09:00:00.000Z",
        ends_at: "2026-09-22T10:00:00.000Z",
      },
    ]);
  });

  it("AS-022: +02:00 offset converts wall clock 11:00-12:00 to 09:00-10:00 UTC (in window)", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-22T11:00:00+02:00",
      ends_at: "2026-09-22T12:00:00+02:00",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-22T09:00:00.000Z",
        ends_at: "2026-09-22T10:00:00.000Z",
      },
    ]);
  });

  it("AS-022: -05:00 offset converts wall clock 04:00-05:00 to 09:00-10:00 UTC (in window)", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-22T04:00:00-05:00",
      ends_at: "2026-09-22T05:00:00-05:00",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-22T09:00:00.000Z",
        ends_at: "2026-09-22T10:00:00.000Z",
      },
    ]);
  });

  it("AS-022: lowercase z/t timestamps are parsed correctly", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-22t09:00:00z",
      ends_at: "2026-09-22t10:00:00z",
    });
    expect(result).toEqual([
      {
        starts_at: "2026-09-22T09:00:00.000Z",
        ends_at: "2026-09-22T10:00:00.000Z",
      },
    ]);
  });

  it("AS-022: microsecond precision with +00:00 offset is not dropped", () => {
    const result = clipBlockToStackedWindow({
      starts_at: "2026-09-22T09:00:00.123456+00:00",
      ends_at: "2026-09-22T10:00:00.000000+00:00",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.starts_at).toBe("2026-09-22T09:00:00.123Z");
    expect(result[result.length - 1]!.ends_at).toBe("2026-09-22T10:00:00.000Z");
  });
});

describe("TZ invariance (AS-021/AS-022)", () => {
  it("AS-021/022: offset-less string treated as UTC", () => {
    const zResult = clipBlockToStackedWindow({
      starts_at: "2026-09-21T09:00:00Z",
      ends_at: "2026-09-21T10:00:00Z",
    });
    const offsetlessResult = clipBlockToStackedWindow({
      starts_at: "2026-09-21T09:00:00",
      ends_at: "2026-09-21T10:00:00",
    });
    expect(offsetlessResult).toEqual(zResult);
    expect(offsetlessResult).toEqual([
      {
        starts_at: "2026-09-21T09:00:00.000Z",
        ends_at: "2026-09-21T10:00:00.000Z",
      },
    ]);
  });

  it("AS-021/022: space-separated timestamp treated as UTC", () => {
    const zResult = clipBlockToStackedWindow({
      starts_at: "2026-09-21T09:00:00Z",
      ends_at: "2026-09-21T10:00:00Z",
    });
    const spaceResult = clipBlockToStackedWindow({
      starts_at: "2026-09-21 09:00:00",
      ends_at: "2026-09-21 10:00:00",
    });
    expect(spaceResult).toEqual(zResult);
  });

  describe("under TZ=America/Los_Angeles", () => {
    const originalTz = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = "America/Los_Angeles";
    });

    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it("AS-021/022: offset-less and space-separated strings still treated as UTC", () => {
      const zResult = clipBlockToStackedWindow({
        starts_at: "2026-09-21T09:00:00Z",
        ends_at: "2026-09-21T10:00:00Z",
      });
      const offsetlessResult = clipBlockToStackedWindow({
        starts_at: "2026-09-21T09:00:00",
        ends_at: "2026-09-21T10:00:00",
      });
      const spaceResult = clipBlockToStackedWindow({
        starts_at: "2026-09-21 09:00:00",
        ends_at: "2026-09-21 10:00:00",
      });
      expect(offsetlessResult).toEqual(zResult);
      expect(spaceResult).toEqual(zResult);
    });
  });
});
