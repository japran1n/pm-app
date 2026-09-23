// @vitest-environment jsdom
//
// F118 (AS-068): "A project's overview or settings surface displays
// tracked and estimated hours grouped by task type, sourced from
// rpc_project_time_totals." This tests the smallest possible surface —
// one compact card, one row per type — against the exact shape
// getProjectTaskTypeTimeTotals (lib/queries/task-type-time-totals.ts,
// F116's thin wrapper for that RPC) returns, so the assertion fails if
// the card ever silently stops rendering a type's row or its numbers.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TaskTypeTimeCard } from "@/components/task/task-type-time-card";
import type { ProjectTaskTypeTimeTotal } from "@/lib/queries/task-type-time-totals";

afterEach(() => {
  cleanup();
});

const TOTALS: ProjectTaskTypeTimeTotal[] = [
  {
    taskTypeId: "type-delivery",
    taskTypeName: "Delivery",
    systemKey: "delivery",
    isBillable: true,
    trackedMinutes: 125,
    estimatedMinutes: 180,
  },
  {
    taskTypeId: "type-qa",
    taskTypeName: "QA issue",
    systemKey: "qa",
    isBillable: false,
    trackedMinutes: 30,
    estimatedMinutes: 0,
  },
];

describe("TaskTypeTimeCard (F118, AS-068)", () => {
  it("test_AS_068_displays_tracked_and_estimated_hours_grouped_by_task_type", () => {
    render(createElement(TaskTypeTimeCard, { totals: TOTALS }));

    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("QA issue")).toBeInTheDocument();
    // 125 minutes -> "2h 5m", 180 minutes -> "3h", per
    // lib/time/format-duration.ts's own formatting rules.
    expect(screen.getByText(/2 hr 5 min tracked/)).toBeInTheDocument();
    expect(screen.getByText(/3 hr estimated/)).toBeInTheDocument();
    expect(screen.getByText(/30 min tracked/)).toBeInTheDocument();
    expect(screen.getByText(/0 min estimated/)).toBeInTheDocument();
  });

  it("test_AS_068_renders_nothing_for_a_project_with_no_time_totals_yet", () => {
    const { container } = render(
      createElement(TaskTypeTimeCard, { totals: [] }),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
