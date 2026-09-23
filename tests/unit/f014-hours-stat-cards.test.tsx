// F014 (missions/20260923-180648, M4): four stat cards at the top of the
// Hours tab -- Total, Billable, Non-billable, Budget used -- whose values
// must equal the totals the rest of the view already derives from the same
// TeamHoursEntry[] prop.
//
// TT-031: Four stat cards: Total, Billable, Non-billable, Budget used;
// values equal existing totals.

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

const BUDGET: ProjectBudget = {
  soldMinutes: 600,
} as ProjectBudget;

describe("test_TT_031_hours_stat_cards_with_budget", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: BUDGET,
      canManage: false,
    }),
  );

  it("renders a total-hours stat card with the sum of all entry minutes (180m = 3 hr)", () => {
    expect(html).toContain('data-testid="hours-stat-total"');
    expect(html).toContain("3 hr");
  });

  it("renders a billable stat card with only billable minutes (120m = 2 hr)", () => {
    expect(html).toContain('data-testid="hours-stat-billable"');
    expect(html).toContain("2 hr");
  });

  it("renders a non-billable stat card with total minus billable (60m = 1 hr)", () => {
    expect(html).toContain('data-testid="hours-stat-non-billable"');
    expect(html).toContain("1 hr");
  });

  it("renders a budget-used stat card with the same percentage as the budget summary (120/600 = 20%)", () => {
    expect(html).toContain('data-testid="hours-stat-budget"');
    expect(html).toContain("20%");
  });
});

describe("test_TT_031_hours_stat_cards_no_budget", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: null,
      canManage: false,
    }),
  );

  it("shows 'No budget set' in the budget-used card when there is no project budget", () => {
    expect(html).toContain('data-testid="hours-stat-budget"');
    expect(html).toContain("No budget set");
  });
});
