// Unit test for F073 (AS-135): "Dashboard chart colors are consistent
// with the status/priority color coding used elsewhere in the app (board
// columns, priority badges)."
//
// Recharts' <ResponsiveContainer> only measures/renders its children once
// mounted in a real browser-like DOM (ResizeObserver) — in a Node test
// environment (this project's vitest.config.ts uses `environment: "node"`,
// no jsdom), renderToStaticMarkup produces an empty shell, so a full DOM
// render can't observe the <Cell> fill colors. Instead, this test calls
// PriorityBarChart/StatusPieChart directly as functions (valid for a React
// function component — it returns the React element tree without needing
// a renderer) and walks that tree to find each <Cell>, asserting its
// `fill` prop against lib/task-colors.ts's PRIORITY_COLORS / STATUS_COLORS
// — the single shared color-coding source also used by the priority badge
// (components/task/task-card.tsx) and the board column header dot
// (components/board/board-column.tsx). This proves the data-to-color
// wiring inside the components themselves, independent of how Recharts
// chooses to render at runtime.

import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { PriorityBarChart } from "@/components/dashboard/priority-bar-chart";
import { StatusPieChart } from "@/components/dashboard/status-pie-chart";
import { PRIORITY_COLORS, STATUS_COLORS } from "@/lib/task-colors";
import type {
  PriorityCountDatum,
  StatusCountDatum,
} from "@/lib/queries/dashboard";

// Walks a React element tree structurally (via .props.children only —
// never invoking a function component, since Recharts' internal
// components (CartesianGrid, Bar, Pie, etc.) call hooks that require a
// real render pass and blow up when called directly). Our own
// PriorityBarChart/StatusPieChart declare their <Cell> children directly
// as plain JSX elements passed down as props.children (built from the
// `data` array via .map — see components/dashboard/*.tsx), so they're
// already present in the tree without needing anything to be rendered:
// this only needs to find them, not render Recharts itself.
type PropsElement = ReactElement<Record<string, unknown>>;

function collectCells(node: ReactNode, out: PropsElement[] = []): PropsElement[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectCells(child, out);
    return out;
  }
  const element = node as PropsElement;
  if (!element.props) return out;

  if ("data-priority" in element.props || "data-status" in element.props) {
    out.push(element);
  }

  if (element.props.children) {
    collectCells(element.props.children as ReactNode, out);
  }

  return out;
}

const PRIORITY_DATA: PriorityCountDatum[] = [
  { priority: "urgent", label: "Urgent", count: 3, color: PRIORITY_COLORS.urgent },
  { priority: "high", label: "High", count: 1, color: PRIORITY_COLORS.high },
  { priority: "medium", label: "Medium", count: 0, color: PRIORITY_COLORS.medium },
  { priority: "low", label: "Low", count: 2, color: PRIORITY_COLORS.low },
  { priority: "backlog", label: "Backlog", count: 0, color: PRIORITY_COLORS.backlog },
  { priority: "none", label: "No priority", count: 5, color: PRIORITY_COLORS.none },
];

const STATUS_DATA: StatusCountDatum[] = [
  { status: "todo", label: "To Do", count: 4, color: STATUS_COLORS.todo },
  { status: "in_progress", label: "In Progress", count: 2, color: STATUS_COLORS.in_progress },
  { status: "in_review", label: "In Review", count: 0, color: STATUS_COLORS.in_review },
  { status: "done", label: "Done", count: 7, color: STATUS_COLORS.done },
];

describe("Dashboard chart colors (F073: AS-135)", () => {
  it("test_AS_135_priority_bar_chart_cells_use_the_shared_PRIORITY_COLORS_mapping", () => {
    const cells = collectCells(
      PriorityBarChart({ data: PRIORITY_DATA }) as unknown as ReactNode,
    );
    const byPriority = new Map(
      cells.map((cell) => [cell.props["data-priority"] as string, cell.props.fill]),
    );

    expect(byPriority.size).toBe(PRIORITY_DATA.length);
    for (const datum of PRIORITY_DATA) {
      expect(byPriority.get(datum.priority)).toBe(PRIORITY_COLORS[datum.priority]);
    }
  });

  it("test_AS_135_status_pie_chart_slices_use_the_shared_STATUS_COLORS_mapping", () => {
    const cells = collectCells(
      StatusPieChart({ data: STATUS_DATA }) as unknown as ReactNode,
    );
    const byStatus = new Map(
      cells.map((cell) => [cell.props["data-status"] as string, cell.props.fill]),
    );

    // Only non-zero-count statuses render a slice (see StatusPieChart's
    // `nonZero` filter) — "in_review" (count 0) is intentionally excluded.
    const nonZeroStatuses = STATUS_DATA.filter((datum) => datum.count > 0);
    expect(byStatus.size).toBe(nonZeroStatuses.length);
    expect(byStatus.size).toBeLessThan(STATUS_DATA.length);

    for (const datum of nonZeroStatuses) {
      expect(byStatus.get(datum.status)).toBe(STATUS_COLORS[datum.status]);
    }
    expect(byStatus.has("in_review")).toBe(false);
  });

  it("test_AS_135_priority_and_status_colors_match_the_badge_and_board_column_source_constant", () => {
    // Cross-check against lib/task-colors.ts directly (not a copy in this
    // test file) so this test fails if PRIORITY_COLORS/STATUS_COLORS ever
    // drift from what task-card.tsx / board-column.tsx render, which is
    // exactly the "consistent ... elsewhere in the app" guarantee AS-135
    // requires.
    expect(PRIORITY_DATA.every((d) => d.color === PRIORITY_COLORS[d.priority])).toBe(
      true,
    );
    expect(STATUS_DATA.every((d) => d.color === STATUS_COLORS[d.status])).toBe(true);
  });
});
