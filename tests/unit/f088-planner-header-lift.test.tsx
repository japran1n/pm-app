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

// F094 (AS-023/F088 hardening): `page.tsx` carries a source comment --
// "... see <PlannerHeader> below." -- that literally contains the text
// "<PlannerHeader" (and even a closing ">"). A naive
// `source.indexOf("<PlannerHeader")` check matches that comment, not the
// real JSX call site, so it stays green even if <PlannerHeader> is moved
// INSIDE the "week-grid"/"stacked" layout branch (the exact regression
// this feature guards against). Strip comments first so every check below
// targets only live JSX/code.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSX {/* */})
    .replace(/\/\/.*$/gm, ""); // line comments
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
    // F094: work on comment-stripped source so a source comment mentioning
    // "<PlannerHeader" in prose can never stand in for the real JSX call
    // site below.
    const source = stripComments(readSource(PAGE_PATH));

    // <PlannerHeader> must appear in the page's own top-level JSX, before
    // the <Suspense> boundary that wraps the layout branch (WeekGridSection
    // is the only thing that picks "week-grid" vs "stacked").
    const plannerHeaderIndex = source.indexOf("<PlannerHeader");
    const suspenseIndex = source.indexOf("<Suspense");
    expect(plannerHeaderIndex).toBeGreaterThan(-1);
    expect(suspenseIndex).toBeGreaterThan(-1);
    expect(plannerHeaderIndex).toBeLessThan(suspenseIndex);
  });

  it("page.tsx's real <PlannerHeader> call site sits before the layout === conditional, and never inside it", () => {
    const source = stripComments(readSource(PAGE_PATH));

    const plannerHeaderIndex = source.indexOf("<PlannerHeader");
    // The conditional that actually picks "week-grid" vs "stacked"
    // (`if (layout === "stacked") { ... }` inside WeekGridSection) -- not
    // `resolvePlannerLayout(...)`, which only computes the value and runs
    // before PlannerHeader regardless of where the branch itself lives.
    const layoutConditionalIndex = source.indexOf('layout === "');
    expect(plannerHeaderIndex).toBeGreaterThan(-1);
    expect(layoutConditionalIndex).toBeGreaterThan(-1);
    expect(plannerHeaderIndex).toBeLessThan(layoutConditionalIndex);

    // Mutation guard: if <PlannerHeader> were moved inside the
    // "week-grid"/"stacked" branch, it would sit near one of these
    // layout-branch keywords -- assert it never does.
    expect(source).not.toMatch(/(layout|week-grid|stacked)[\s\S]{0,200}<PlannerHeader/);
  });

  it("<PlannerHeader> is rendered exactly once, never duplicated into both layout branches", () => {
    const source = stripComments(readSource(PAGE_PATH));
    const matches = source.match(/<PlannerHeader\b/g) ?? [];
    expect(matches).toHaveLength(1);
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
