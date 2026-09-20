import { describe, expect, it } from "vitest";
import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";

describe("resolvePlannerLayout", () => {
  it("AS-016: when exactly one person is selected, the layout is week-grid", () => {
    expect(resolvePlannerLayout(1)).toBe("week-grid");
  });

  it("AS-016: when zero people are selected, the layout is still week-grid", () => {
    expect(resolvePlannerLayout(0)).toBe("week-grid");
  });

  it("AS-017: when exactly two people are selected, the layout is stacked", () => {
    expect(resolvePlannerLayout(2)).toBe("stacked");
  });

  it("AS-017: when more than two people are selected, the layout is stacked", () => {
    expect(resolvePlannerLayout(5)).toBe("stacked");
  });
});
