// Unit tests for F228 (AS-428): lib/views/apply-view.ts's encode/decode
// round trip is what actually proves "opening a saved view restores its
// filters, sort, and grouping exactly" for the fields the app's existing
// filter machinery supports -- pure logic, no DB/network involved, per
// this feature's Definition of done ("unit for pure logic").

import { describe, expect, it } from "vitest";
import { buildViewSearchParams, parseViewSearchParams } from "@/lib/views/apply-view";
import type { SavedViewConfig } from "@/lib/validation/views";

describe("F228 apply-view (AS-428)", () => {
  it("test_AS_428_a_full_config_round_trips_exactly_through_url_search_params", () => {
    const config: SavedViewConfig = {
      filters: [
        { field: "status", operator: "eq", value: "in_progress" },
        { field: "priority", operator: "eq", value: "high" },
        { field: "assigneeId", operator: "eq", value: "user-123" },
      ],
      sort: [{ field: "dueDate", direction: "asc" }],
      groupBy: "assignee",
    };

    const params = buildViewSearchParams(config);
    expect(params.get("status")).toBe("in_progress");
    expect(params.get("priority")).toBe("high");
    expect(params.get("assigneeId")).toBe("user-123");
    expect(params.get("sort")).toBe("due_date_asc");
    expect(params.get("groupBy")).toBe("assignee");

    const restored = parseViewSearchParams(params);
    expect(restored).toEqual(config);
  });

  it("test_AS_428_an_empty_config_restores_as_an_empty_config", () => {
    const config: SavedViewConfig = { filters: [], sort: [], groupBy: null };
    const params = buildViewSearchParams(config);
    expect(Array.from(params.keys())).toHaveLength(0);
    expect(parseViewSearchParams(params)).toEqual(config);
  });

  it("test_AS_428_desc_sort_direction_round_trips_exactly", () => {
    const config: SavedViewConfig = {
      filters: [],
      sort: [{ field: "dueDate", direction: "desc" }],
      groupBy: null,
    };
    const params = buildViewSearchParams(config);
    expect(params.get("sort")).toBe("due_date_desc");
    expect(parseViewSearchParams(params)).toEqual(config);
  });

  it("test_AS_428_an_unsupported_filter_operator_is_dropped_rather_than_corrupting_the_url", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "status", operator: "neq", value: "done" }],
      sort: [],
      groupBy: null,
    };
    const params = buildViewSearchParams(config);
    expect(params.get("status")).toBeNull();
  });
});
