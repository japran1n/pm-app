// Unit tests for F040's isOverdue pure helper (AS-063, AS-064).

import { describe, expect, it } from "vitest";

import { isOverdue } from "@/lib/tasks/is-overdue";

function daysFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

describe("isOverdue (AS-064)", () => {
  it("is true for a past due date with a non-done status", () => {
    expect(isOverdue(daysFromToday(-3), "todo")).toBe(true);
    expect(isOverdue(daysFromToday(-1), "in_progress")).toBe(true);
    expect(isOverdue(daysFromToday(-1), "in_review")).toBe(true);
  });

  it("is false for a past due date when status is done", () => {
    expect(isOverdue(daysFromToday(-3), "done")).toBe(false);
  });

  it("is false for a future due date regardless of status", () => {
    expect(isOverdue(daysFromToday(5), "todo")).toBe(false);
    expect(isOverdue(daysFromToday(5), "done")).toBe(false);
  });

  it("is false when dueDate is null", () => {
    expect(isOverdue(null, "todo")).toBe(false);
    expect(isOverdue(null, "done")).toBe(false);
  });

  it("is false for a due date of today", () => {
    expect(isOverdue(daysFromToday(0), "todo")).toBe(false);
  });

  it("is false for an invalid/unparseable date string", () => {
    expect(isOverdue("not-a-date", "todo")).toBe(false);
  });
});
