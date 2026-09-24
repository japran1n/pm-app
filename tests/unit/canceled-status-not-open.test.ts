// Canceled (category not_started) is closed: never open, overdue or due soon,
// but still not counted as done.
import { describe, expect, it } from "vitest";

import { countProjectHealthTasks } from "@/lib/projects/compute-health";
import { isClosedStatus, isDoneStatus, isOpenStatus } from "@/lib/tasks/status-category";
import { isOverdueInTimeZone } from "@/lib/time/user-timezone";

describe("Canceled status", () => {
  it("is closed and not open, but not done", () => {
    expect(isOpenStatus("Canceled", "not_started")).toBe(false);
    expect(isClosedStatus("Canceled", "not_started")).toBe(true);
    expect(isDoneStatus("Canceled", "not_started")).toBe(false);
    expect(isOpenStatus("To Do", "not_started")).toBe(true);
  });

  it("treats display_group 'closed' as closed regardless of name", () => {
    expect(isOpenStatus("Won't do", "not_started", "closed")).toBe(false);
    expect(isOpenStatus("Won't do", "not_started", "not_started")).toBe(true);
  });

  it("is never overdue", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(isOverdueInTimeZone("2026-01-01", "Canceled", "UTC", now, "not_started")).toBe(false);
    expect(isOverdueInTimeZone("2026-01-01", "To Do", "UTC", now, "not_started")).toBe(true);
  });

  it("does not count toward project health overdue", () => {
    const counts = countProjectHealthTasks(
      [
        { status: "Canceled", category: "not_started", dueDate: "2026-01-01" },
        { status: "To Do", category: "not_started", dueDate: "2026-01-01" },
      ] as never,
      "2026-09-24",
    );
    expect(counts.overdueTaskCount).toBe(1);
    expect(counts.doneTaskCount).toBe(0);
  });
});
