// @vitest-environment jsdom
//
// F088: the shared Planner header -- PeopleSwitcherUrlBound, the
// prev/today/next week-nav controls, and the week label -- is lifted out
// of WeekView (where it used to live alone) and rendered ONCE in page.tsx,
// ABOVE the "week-grid"/"stacked" layout branch. Before this fix,
// selecting 2+ people ("stacked" layout) rendered <StackedPlanner>, which
// has no header of its own, so the switcher vanished and there was no way
// back to fewer people without hand-editing the URL.
//
// These are source-level checks (this route is a Server Component; see
// tests/unit/f031-page-layout-derivation.test.tsx and
// tests/unit/f012-slug-validation.test.ts for this project's established
// convention of asserting on page.tsx's own source for RSC routes) plus a
// component-level check that <StackedPlanner> itself never renders the
// switcher.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// F035: StackedPlanner is a Client Component that calls useRouter() (for its
// own drag-to-reorder persistence) -- unrelated to this feature, but its
// mount requires the same next/navigation mock other component tests in
// this repo use (e.g. tests/unit/f032-stacked-shell.test.tsx does not need
// it only because it predates F035's drag-reorder addition).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

import { StackedPlanner } from "@/components/calendar/stacked-planner";

afterEach(cleanup);

const PAGE_PATH = path.join(
  process.cwd(),
  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
);
const STACKED_PLANNER_PATH = path.join(
  process.cwd(),
  "components/calendar/stacked-planner.tsx",
);
const WEEK_VIEW_PATH = path.join(process.cwd(), "components/calendar/week-view.tsx");

function readSource(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("F088: PeopleSwitcherUrlBound is NOT rendered inside StackedPlanner", () => {
  it("StackedPlanner's own source never imports or references PeopleSwitcherUrlBound", () => {
    const source = readSource(STACKED_PLANNER_PATH);
    expect(source).not.toMatch(/PeopleSwitcherUrlBound/);
  });

  it("StackedPlanner's rendered output contains no people-switcher trigger", () => {
    const { container } = render(
      <StackedPlanner
        selectedUserIds={["user-1", "user-2"]}
        blocksByUser={new Map()}
        weekKey="2026-09-14"
        members={[
          { userId: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
          { userId: "user-2", name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
        ]}
      />,
    );

    expect(
      container.querySelector('[data-slot="people-switcher-trigger"]'),
    ).not.toBeInTheDocument();
  });
});

describe("F088: WeekView no longer renders the switcher/nav header either", () => {
  it("WeekView's own source never references PeopleSwitcherUrlBound", () => {
    const source = readSource(WEEK_VIEW_PATH);
    expect(source).not.toMatch(/PeopleSwitcherUrlBound/);
  });
});

describe("F088: the switcher's props come from page-level data, not from inside a layout branch", () => {
  it("page.tsx renders <PlannerHeader> above the Suspense/layout boundary, not inside WeekGridSection", () => {
    const source = readSource(PAGE_PATH);

    // <PlannerHeader> must appear in the page's own top-level JSX, before
    // the <Suspense> boundary that wraps the layout branch (WeekGridSection
    // is the only thing that picks "week-grid" vs "stacked").
    const plannerHeaderIndex = source.indexOf("<PlannerHeader");
    const suspenseIndex = source.indexOf("<Suspense");
    expect(plannerHeaderIndex).toBeGreaterThan(-1);
    expect(suspenseIndex).toBeGreaterThan(-1);
    expect(plannerHeaderIndex).toBeLessThan(suspenseIndex);
  });

  it("PlannerHeader's peopleSwitcher prop is built from page-level switcherMembers/selectedUserIds, not theaded through WeekGridSection's layout branches", () => {
    const source = readSource(PAGE_PATH);

    // The <PlannerHeader ...> call site (top-level, before WeekGridSection)
    // is the one place `workspaceSlug`/`selectedUserIds` feed the switcher.
    const headerBlockMatch = source.match(/<PlannerHeader[\s\S]*?\/>/);
    expect(headerBlockMatch).not.toBeNull();
    const headerBlock = headerBlockMatch![0];

    expect(headerBlock).toMatch(/workspaceSlug=\{workspaceSlug\}/);
    expect(headerBlock).toMatch(/selectedUserIds,/);
    expect(headerBlock).toMatch(/members:\s*switcherMembers,/);

    // Neither layout branch (StackedPlanner nor WeekView, both rendered
    // inside WeekGridSection) receives a `peopleSwitcher` prop any more --
    // it's exclusively PlannerHeader's.
    const weekViewCallMatch = source.match(/<WeekView[\s\S]*?\/>/);
    expect(weekViewCallMatch).not.toBeNull();
    expect(weekViewCallMatch![0]).not.toMatch(/\bpeopleSwitcher=/);

    const stackedPlannerCallMatch = source.match(/<StackedPlanner[\s\S]*?\/>/);
    expect(stackedPlannerCallMatch).not.toBeNull();
    expect(stackedPlannerCallMatch![0]).not.toMatch(/\bpeopleSwitcher=/);
  });
});
