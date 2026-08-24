// Unit tests for F227's lib/validation/views.ts (AS-426, AS-427) -- the
// Zod mirror of supabase/migrations/20260826010000_create_saved_views.sql's
// DB-level CHECK constraints, per this feature's "the DB is the last line,
// not the only line" convention. These tests exercise the Zod layer
// directly; tests/integration/rls-saved-views.test.ts exercises the DB
// CHECKs directly against the real database.

import { describe, expect, it } from "vitest";
import {
  createSavedViewSchema,
  savedViewConfigSchema,
  savedViewScopeSchema,
  savedViewTypeSchema,
} from "@/lib/validation/views";

describe("F227 saved-views validation (AS-426, AS-427)", () => {
  it("test_AS_426_a_valid_config_with_filters_sort_and_grouping_parses", () => {
    const result = savedViewConfigSchema.safeParse({
      filters: [{ field: "priority", operator: "eq", value: "urgent" }],
      sort: [{ field: "due_date", direction: "asc" }],
      groupBy: "assignee",
    });
    expect(result.success).toBe(true);
  });

  it("test_AS_426_an_empty_config_is_valid_default_state", () => {
    const result = savedViewConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ filters: [], sort: [], groupBy: null });
    }
  });

  it("test_AS_426_a_sort_entry_with_an_invalid_direction_is_rejected", () => {
    const result = savedViewConfigSchema.safeParse({
      sort: [{ field: "due_date", direction: "sideways" }],
    });
    expect(result.success).toBe(false);
  });

  it("test_AS_427_scope_only_accepts_personal_or_shared", () => {
    expect(savedViewScopeSchema.safeParse("personal").success).toBe(true);
    expect(savedViewScopeSchema.safeParse("shared").success).toBe(true);
    expect(savedViewScopeSchema.safeParse("public").success).toBe(false);
  });

  it("test_AS_426_view_type_covers_board_list_calendar_and_timeline_from_the_start", () => {
    for (const type of ["board", "list", "calendar", "timeline"]) {
      expect(savedViewTypeSchema.safeParse(type).success).toBe(true);
    }
    expect(savedViewTypeSchema.safeParse("gantt").success).toBe(false);
  });

  it("test_AS_426_a_full_create_payload_with_all_fields_parses", () => {
    const result = createSavedViewSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      name: "My view",
      scope: "shared",
      viewType: "board",
      config: {
        filters: [{ field: "status", operator: "eq", value: "done" }],
        sort: [{ field: "name", direction: "desc" }],
        groupBy: "priority",
      },
      isDefault: true,
    });
    expect(result.success).toBe(true);
  });

  it("test_AS_426_an_empty_name_is_rejected_by_zod_mirroring_the_db_check", () => {
    const result = createSavedViewSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      projectId: null,
      name: "   ",
    });
    expect(result.success).toBe(false);
  });
});
