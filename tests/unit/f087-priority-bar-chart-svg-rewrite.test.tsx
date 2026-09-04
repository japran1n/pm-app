// @vitest-environment jsdom
//
// F087 accessibility/perf audit items 4 & 5:
// components/dashboard/priority-bar-chart.tsx used to render its bars as
// Recharts <Cell> elements -- SVG <rect>s with a click handler but no
// `tabIndex`/role/name, so the chart's documented click-to-filter feature
// was mouse-only. It was also the ONLY consumer of the `recharts`
// dependency in the repo. Rewritten as inline markup mirroring
// components/dashboard/status-pie-chart.tsx: real <button> elements per
// bar (keyboard + screen-reader operable, per-bar accessible name/title),
// a count printed directly on every bar, and the dependency removed from
// package.json.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/w/acme",
  useSearchParams: () => searchParamsValue,
}));

import { PriorityBarChart } from "@/components/dashboard/priority-bar-chart";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import type { PriorityCountDatum } from "@/lib/queries/dashboard";

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  searchParamsValue = new URLSearchParams();
});

const DATA: PriorityCountDatum[] = [
  { priority: "urgent", label: PRIORITY_LABELS.urgent, count: 3, color: PRIORITY_COLORS.urgent },
  { priority: "high", label: PRIORITY_LABELS.high, count: 1, color: PRIORITY_COLORS.high },
  { priority: "medium", label: PRIORITY_LABELS.medium, count: 0, color: PRIORITY_COLORS.medium },
  { priority: "none", label: PRIORITY_LABELS.none, count: 5, color: PRIORITY_COLORS.none },
];

describe("test_priority_bar_chart_bars_are_real_keyboard_operable_buttons", () => {
  it("renders a focusable <button> per clickable priority, with the count as direct on-bar text", () => {
    render(<PriorityBarChart data={DATA} />);
    const urgentButton = screen.getByRole("button", { name: /Urgent/ });
    expect(urgentButton).toBeInTheDocument();
    expect(urgentButton).toHaveTextContent("3");
    expect(urgentButton).toHaveTextContent(PRIORITY_LABELS.urgent);
  });

  it("clicking a clickable bar writes ?priority=<value> via router.push", () => {
    render(<PriorityBarChart data={DATA} />);
    screen.getByRole("button", { name: /Urgent/ }).click();
    expect(pushMock).toHaveBeenCalledWith("/w/acme?priority=urgent", { scroll: false });
  });

  it("clicking the same active bar again clears the filter", () => {
    searchParamsValue = new URLSearchParams("priority=urgent");
    render(<PriorityBarChart data={DATA} />);
    screen.getByRole("button", { name: /Urgent/ }).click();
    expect(pushMock).toHaveBeenCalledWith("/w/acme", { scroll: false });
  });

  it("the 'none' priority segment is not a button (nothing in the task table's VALID_PRIORITIES to filter to)", () => {
    render(<PriorityBarChart data={DATA} />);
    expect(
      screen.queryByRole("button", { name: new RegExp(PRIORITY_LABELS.none) }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("priority-bar-static")).toHaveTextContent("5");
  });

  it("every bar/segment element still carries the shared PRIORITY_COLORS value via data-color, for AS-135's color-consistency check", () => {
    render(<PriorityBarChart data={DATA} />);
    // Direct attribute check per datum (data-priority/data-color), same
    // shape dashboard-chart-colors.test.ts asserts against.
    const urgentButton = screen.getByRole("button", { name: /Urgent/ });
    const urgentBar = urgentButton.querySelector('[data-priority="urgent"]');
    expect(urgentBar).toHaveAttribute("data-color", PRIORITY_COLORS.urgent);

    const noneBar = screen
      .getByTestId("priority-bar-static")
      .querySelector('[data-priority="none"]');
    expect(noneBar).toHaveAttribute("data-color", PRIORITY_COLORS.none);
  });
});

describe("test_recharts_dependency_removed", () => {
  it("package.json no longer lists recharts as a dependency", async () => {
    const pkg = await import("../../package.json");
    expect(pkg.dependencies).not.toHaveProperty("recharts");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("recharts");
  });
});
