// F016 (missions/20260923-180648, M4): "By person" card rows in the Hours
// tab gain a visual bar (relative to the person with the most logged
// minutes) alongside each person's total.
//
// TT-034: By-person list with bars replaces the current By person card;
// totals unchanged.
// TT-035: Existing tables (all entries, by category, task type) still
// present.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TeamHoursView } from "@/components/project/team-hours-view";
import type { TeamHoursEntry } from "@/lib/queries/hours";
import type { ProjectBudget } from "@/lib/queries/project-budgets";

const ENTRIES: TeamHoursEntry[] = [
  {
    entryId: "e1",
    userId: "u1",
    taskId: "t1",
    taskTitle: "Task one",
    minutes: 120,
    billable: true,
    entryDate: "2026-09-01",
    workCategory: "development",
  } as TeamHoursEntry,
  {
    entryId: "e2",
    userId: "u2",
    taskId: "t2",
    taskTitle: "Task two",
    minutes: 60,
    billable: false,
    entryDate: "2026-09-02",
    workCategory: "qa",
  } as TeamHoursEntry,
];

const PEOPLE: Record<string, string> = { u1: "Alice", u2: "Bob" };

const BUDGET: ProjectBudget = { soldMinutes: 600 } as ProjectBudget;

describe("test_TT_034_by_person_bars_and_totals_unchanged", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: BUDGET,
      canManage: false,
    }),
  );

  it("renders a per-person share bar sized relative to the max person total", () => {
    const bars = html.match(/share of logged hours/g) ?? [];
    expect(bars.length).toBe(2);
    // Alice has 120m (max) -> 100% width; Bob has 60m -> 50% width.
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuenow="50"');
  });

  it("keeps the per-person total hours correct", () => {
    expect(html).toContain("2 hr");
    expect(html).toContain("1 hr");
  });

  it("still renders each person's name", () => {
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
  });
});

describe("test_TT_035_existing_tables_still_present", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: BUDGET,
      canManage: false,
    }),
  );

  it("keeps the By category card", () => {
    expect(html).toContain("By category");
    expect(html).toContain("Development");
    expect(html).toContain("QA");
  });

  it("keeps the All entries table", () => {
    expect(html).toContain("All entries");
    expect(html).toContain('data-testid="hours-entry-row"');
  });
});
