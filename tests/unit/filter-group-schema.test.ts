// Unit tests for the nested AND/OR filter-group schema and backward-compat
// adapter added to lib/validation/views.ts (follow-up to F227/F229's flat
// filter shape). Covers: recursive Zod validation of arbitrarily nested
// groups, and normalizeFilterGroup/resolveEffectiveFilterGroup lifting the
// pre-existing flat `filters` array into the trivial one-level "and" group
// shape without requiring any `saved_views` row migration.

import { describe, expect, it } from "vitest";

import {
  filterGroupSchema,
  normalizeFilterGroup,
  resolveEffectiveFilterGroup,
  savedViewConfigSchema,
} from "@/lib/validation/views";

describe("filterGroupSchema (nested AND/OR groups)", () => {
  it("test_a_flat_and_group_of_leaf_conditions_parses", () => {
    const result = filterGroupSchema.safeParse({
      combinator: "and",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        { field: "priority", operator: "in", value: ["high", "urgent"] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("test_a_group_nested_inside_a_group_parses_recursively", () => {
    const result = filterGroupSchema.safeParse({
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        {
          combinator: "and",
          conditions: [
            { field: "priority", operator: "eq", value: "high" },
            {
              combinator: "or",
              conditions: [{ field: "assigneeId", operator: "in", value: ["u1", "u2"] }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("test_an_invalid_combinator_is_rejected", () => {
    const result = filterGroupSchema.safeParse({ combinator: "xor", conditions: [] });
    expect(result.success).toBe(false);
  });

  it("test_a_leaf_condition_with_an_unsupported_operator_is_rejected", () => {
    const result = filterGroupSchema.safeParse({
      combinator: "and",
      conditions: [{ field: "status", operator: "gt", value: "todo" }],
    });
    expect(result.success).toBe(false);
  });

  it("test_savedViewConfigSchema_accepts_a_filterGroup_alongside_the_legacy_filters_array", () => {
    const result = savedViewConfigSchema.safeParse({
      filters: [],
      filterGroup: {
        combinator: "or",
        conditions: [
          { field: "status", operator: "eq", value: "todo" },
          { field: "status", operator: "eq", value: "done" },
        ],
      },
      sort: [],
      groupBy: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("normalizeFilterGroup (backward compatibility with the flat legacy shape)", () => {
  it("test_an_empty_flat_array_normalizes_to_an_empty_and_group", () => {
    expect(normalizeFilterGroup([])).toEqual({ combinator: "and", conditions: [] });
  });

  it("test_a_flat_array_of_eq_conditions_normalizes_to_a_trivial_and_group", () => {
    const legacy = [
      { field: "status", operator: "eq", value: "todo" },
      { field: "priority", operator: "eq", value: "high" },
    ];
    expect(normalizeFilterGroup(legacy)).toEqual({
      combinator: "and",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        { field: "priority", operator: "eq", value: "high" },
      ],
    });
  });

  it("test_a_flat_array_with_an_in_condition_preserves_its_array_value", () => {
    const legacy = [{ field: "status", operator: "in", value: ["todo", "in_progress"] }];
    expect(normalizeFilterGroup(legacy)).toEqual({
      combinator: "and",
      conditions: [{ field: "status", operator: "in", value: ["todo", "in_progress"] }],
    });
  });

  it("test_an_already_grouped_shape_passes_through_unchanged", () => {
    const group = {
      combinator: "or" as const,
      conditions: [{ field: "status", operator: "eq" as const, value: "todo" }],
    };
    expect(normalizeFilterGroup(group)).toEqual(group);
  });

  it("test_a_malformed_legacy_entry_is_dropped_rather_than_throwing", () => {
    const legacy = [{ field: "status", operator: "unsupported-op", value: "todo" }];
    expect(normalizeFilterGroup(legacy)).toEqual({ combinator: "and", conditions: [] });
  });
});

describe("resolveEffectiveFilterGroup", () => {
  it("test_prefers_filterGroup_when_present", () => {
    const config = savedViewConfigSchema.parse({
      filters: [{ field: "status", operator: "eq", value: "todo" }],
      filterGroup: {
        combinator: "or",
        conditions: [{ field: "priority", operator: "eq", value: "high" }],
      },
    });
    expect(resolveEffectiveFilterGroup(config)).toEqual({
      combinator: "or",
      conditions: [{ field: "priority", operator: "eq", value: "high" }],
    });
  });

  it("test_falls_back_to_lifting_the_legacy_filters_array_when_no_filterGroup_is_present", () => {
    const config = savedViewConfigSchema.parse({
      filters: [{ field: "status", operator: "eq", value: "todo" }],
    });
    expect(resolveEffectiveFilterGroup(config)).toEqual({
      combinator: "and",
      conditions: [{ field: "status", operator: "eq", value: "todo" }],
    });
  });
});
