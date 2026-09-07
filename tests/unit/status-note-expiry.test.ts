import { describe, expect, it } from "vitest";

import { isStatusNoteActive } from "@/lib/status-note";

describe("isStatusNoteActive", () => {
  it("test_status_note_active_when_no_until_date_is_set", () => {
    expect(isStatusNoteActive("Back Monday", null, "2026-09-06")).toBe(true);
  });

  it("test_status_note_active_when_until_date_is_in_the_future", () => {
    expect(isStatusNoteActive("Back Monday", "2026-09-10", "2026-09-06")).toBe(true);
  });

  it("test_status_note_active_when_until_date_is_today", () => {
    expect(isStatusNoteActive("Back Monday", "2026-09-06", "2026-09-06")).toBe(true);
  });

  it("test_status_note_inactive_when_until_date_has_passed", () => {
    expect(isStatusNoteActive("Back Monday", "2026-09-01", "2026-09-06")).toBe(false);
  });

  it("test_status_note_inactive_when_note_is_null", () => {
    expect(isStatusNoteActive(null, null, "2026-09-06")).toBe(false);
  });

  it("test_status_note_inactive_when_note_is_empty_or_whitespace", () => {
    expect(isStatusNoteActive("   ", null, "2026-09-06")).toBe(false);
    expect(isStatusNoteActive("", null, "2026-09-06")).toBe(false);
  });
});
