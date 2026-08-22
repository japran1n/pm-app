// Unit tests for F195's pure diffing helper (AS-355: status, assignee,
// priority, due date, estimate, and title changes record old and new
// values). Tests derive from AS-355's assertion text, not from the
// implementation: each named field gets its own explicit test (this
// mission's established convention — never looped), plus the boundary
// cases the clarified spec names (empty input, no-op/unchanged values,
// a field present in `after` but not `before`).

import { describe, expect, it } from "vitest";
import { diffTaskFields } from "@/lib/activity/task-activity";

describe("diffTaskFields (F195, AS-355)", () => {
  it("test_AS_355_title_change_records_old_and_new_values", () => {
    const changes = diffTaskFields(
      { title: "Old title" },
      { title: "New title" },
    );
    expect(changes).toEqual([
      { field: "title", oldValue: "Old title", newValue: "New title" },
    ]);
  });

  it("test_AS_355_status_change_records_old_and_new_values", () => {
    const changes = diffTaskFields(
      { status: "todo" },
      { status: "in_progress" },
    );
    expect(changes).toEqual([
      { field: "status", oldValue: "todo", newValue: "in_progress" },
    ]);
  });

  it("test_AS_355_assignee_change_records_old_and_new_values", () => {
    const changes = diffTaskFields(
      { assignee_id: "user-old" },
      { assignee_id: "user-new" },
    );
    expect(changes).toEqual([
      { field: "assignee_id", oldValue: "user-old", newValue: "user-new" },
    ]);
  });

  it("test_AS_355_priority_change_records_old_and_new_values", () => {
    const changes = diffTaskFields(
      { priority: "low" },
      { priority: "urgent" },
    );
    expect(changes).toEqual([
      { field: "priority", oldValue: "low", newValue: "urgent" },
    ]);
  });

  it("test_AS_355_due_date_change_records_old_and_new_values", () => {
    const changes = diffTaskFields(
      { due_date: "2026-08-20" },
      { due_date: "2026-09-01" },
    );
    expect(changes).toEqual([
      { field: "due_date", oldValue: "2026-08-20", newValue: "2026-09-01" },
    ]);
  });

  it("test_AS_355_estimate_change_records_old_and_new_values", () => {
    const changes = diffTaskFields(
      { estimate_minutes: 30 },
      { estimate_minutes: 90 },
    );
    expect(changes).toEqual([
      { field: "estimate", oldValue: 30, newValue: 90 },
    ]);
  });

  it("test_AS_355_multiple_fields_changed_at_once_each_gets_its_own_entry", () => {
    const changes = diffTaskFields(
      { title: "A", priority: "low", due_date: null },
      { title: "B", priority: "high", due_date: "2026-10-01" },
    );
    expect(changes).toHaveLength(3);
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "title", oldValue: "A", newValue: "B" },
        { field: "priority", oldValue: "low", newValue: "high" },
        { field: "due_date", oldValue: null, newValue: "2026-10-01" },
      ]),
    );
  });

  it("test_AS_355_null_to_value_and_value_to_null_are_both_recorded", () => {
    const clearing = diffTaskFields(
      { due_date: "2026-08-20" },
      { due_date: null },
    );
    expect(clearing).toEqual([
      { field: "due_date", oldValue: "2026-08-20", newValue: null },
    ]);

    const setting = diffTaskFields(
      { assignee_id: null },
      { assignee_id: "user-1" },
    );
    expect(setting).toEqual([
      { field: "assignee_id", oldValue: null, newValue: "user-1" },
    ]);
  });

  it("empty/zero state: no fields provided returns an explicit empty array", () => {
    expect(diffTaskFields({}, {})).toEqual([]);
  });

  it("empty/zero state: identical before/after values produce no entries", () => {
    const changes = diffTaskFields(
      { title: "Same", status: "todo", priority: null },
      { title: "Same", status: "todo", priority: null },
    );
    expect(changes).toEqual([]);
  });

  it("boundary: a field present in `after` but absent from `before` is never diffed (no prior value to compare against)", () => {
    const changes = diffTaskFields({}, { title: "Brand new value" });
    expect(changes).toEqual([]);
  });

  it("boundary: a field present in `before` but absent from `after` is never diffed (caller didn't touch that field)", () => {
    const changes = diffTaskFields({ title: "Untouched" }, {});
    expect(changes).toEqual([]);
  });
});
