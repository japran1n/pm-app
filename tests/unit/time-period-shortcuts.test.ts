// Unit coverage for lib/time/period-shortcuts.ts — the "Today"/"This
// week"/"This month" shortcuts on the workspace Time report page.
import { describe, expect, it } from "vitest";
import { getPeriodShortcuts } from "@/lib/time/period-shortcuts";

describe("getPeriodShortcuts", () => {
  it("returns today as a single-day range", () => {
    const now = new Date(2026, 8, 10); // Thursday, Sept 10 2026
    const shortcuts = getPeriodShortcuts(now);
    const today = shortcuts.find((s) => s.key === "today")!;
    expect(today.start).toBe("2026-09-10");
    expect(today.end).toBe("2026-09-10");
  });

  it("returns this week starting on Monday", () => {
    const now = new Date(2026, 8, 10); // Thursday, Sept 10 2026
    const shortcuts = getPeriodShortcuts(now);
    const week = shortcuts.find((s) => s.key === "week")!;
    expect(week.start).toBe("2026-09-07"); // Monday of that week
    expect(week.end).toBe("2026-09-10");
  });

  it("returns this month starting on the 1st", () => {
    const now = new Date(2026, 8, 10);
    const shortcuts = getPeriodShortcuts(now);
    const month = shortcuts.find((s) => s.key === "month")!;
    expect(month.start).toBe("2026-09-01");
    expect(month.end).toBe("2026-09-10");
  });

  it("handles a Monday correctly for the week shortcut (no off-by-one)", () => {
    const monday = new Date(2026, 8, 7); // Sept 7 2026 is a Monday
    const shortcuts = getPeriodShortcuts(monday);
    const week = shortcuts.find((s) => s.key === "week")!;
    expect(week.start).toBe("2026-09-07");
  });

  it("handles a Sunday correctly for the week shortcut", () => {
    const sunday = new Date(2026, 8, 6); // Sept 6 2026 is a Sunday
    const shortcuts = getPeriodShortcuts(sunday);
    const week = shortcuts.find((s) => s.key === "week")!;
    expect(week.start).toBe("2026-08-31"); // preceding Monday
  });
});
