// Unit tests for F040's isOverdue pure helper (AS-063, AS-064). F124
// (AS-207) added a required `timeZone` argument — every call below passes
// "UTC" explicitly so these regression tests (mission-1 behaviour that
// must keep passing per the clarification's Round B #3) stay meaningful
// without depending on the machine's own local timezone. F124's own
// timezone-specific behaviour (a task overdue for one user's zone but not
// another's at the same instant, DST boundaries) is covered separately in
// tests/unit/user-timezone.test.ts, where the "AS-207" test names live.

import { describe, expect, it } from "vitest";

import { isOverdue } from "@/lib/tasks/is-overdue";

// UTC-anchored, unlike the machine's local `Date.setDate`, so this is
// deterministic regardless of which timezone the test runner's own host
// happens to be in.
function daysFromToday(offset: number): string {
  const now = new Date();
  const todayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(todayUtcMs + offset * 86_400_000).toISOString().slice(0, 10);
}

describe("isOverdue (AS-064)", () => {
  it("is true for a past due date with a non-done status", () => {
    expect(isOverdue(daysFromToday(-3), "todo", "UTC")).toBe(true);
    expect(isOverdue(daysFromToday(-1), "in_progress", "UTC")).toBe(true);
    expect(isOverdue(daysFromToday(-1), "in_review", "UTC")).toBe(true);
  });

  it("is false for a past due date when status is done", () => {
    expect(isOverdue(daysFromToday(-3), "done", "UTC")).toBe(false);
  });

  it("is false for a future due date regardless of status", () => {
    expect(isOverdue(daysFromToday(5), "todo", "UTC")).toBe(false);
    expect(isOverdue(daysFromToday(5), "done", "UTC")).toBe(false);
  });

  it("is false when dueDate is null", () => {
    expect(isOverdue(null, "todo", "UTC")).toBe(false);
    expect(isOverdue(null, "done", "UTC")).toBe(false);
  });

  it("is false for a due date of today", () => {
    expect(isOverdue(daysFromToday(0), "todo", "UTC")).toBe(false);
  });

  it("is false for an invalid/unparseable date string", () => {
    expect(isOverdue("not-a-date", "todo", "UTC")).toBe(false);
  });
});
