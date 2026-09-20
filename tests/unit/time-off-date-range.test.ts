import { describe, expect, it } from "vitest";

import { eachDateInRange } from "@/lib/calendar/date-utils";
import { createTimeOffSchema } from "@/lib/validation/time-off";

describe("eachDateInRange", () => {
  it("test_each_date_in_range_returns_every_date_inclusive_of_both_endpoints", () => {
    expect(eachDateInRange("2026-04-01", "2026-04-03")).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
    ]);
  });

  it("test_each_date_in_range_returns_a_single_date_for_a_one_day_range", () => {
    expect(eachDateInRange("2026-04-01", "2026-04-01")).toEqual(["2026-04-01"]);
  });
});

describe("createTimeOffSchema", () => {
  it("test_create_time_off_schema_accepts_a_valid_range", () => {
    const result = createTimeOffSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      startDate: "2026-04-01",
      endDate: "2026-04-05",
      note: "Godišnji odmor",
    });
    expect(result.success).toBe(true);
  });

  it("test_create_time_off_schema_rejects_end_date_before_start_date", () => {
    const result = createTimeOffSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      startDate: "2026-04-05",
      endDate: "2026-04-01",
    });
    expect(result.success).toBe(false);
  });
});
