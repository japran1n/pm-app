// @vitest-environment jsdom
//
// F237 (AS-451, AS-452, AS-457, AS-458) component-level render guard --
// proves the scale/today-line/bar/marker markup is actually PRESENT from
// real typed props (not hand-waved), mirroring
// tests/unit/f235-calendar-responsive-render.test.tsx's own "both trees
// exist and are wired correctly" shape. The real live-interaction proof
// of the scroll container not breaking layout is out of reach here (every
// authenticated Playwright spec currently fails in the shared login
// helper -- a pre-existing repo issue, documented in this feature's
// handoff) -- this file is the closest available real-DOM evidence for
// AS-457/AS-458 short of that.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TimelineScale } from "@/components/timeline/timeline-scale";
import { TimelineBar } from "@/components/timeline/timeline-bar";
import { computeBarLayout } from "@/lib/timeline/layout";
import type { TimelineTask } from "@/lib/queries/timeline";

afterEach(cleanup);

function makeTask(overrides: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: "task-1",
    title: "Ship the timeline",
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority: "medium",
    startDate: "2026-08-05",
    dueDate: "2026-08-10",
    number: 12,
    projectId: "project-1",
    projectKey: "PM",
    projectName: "Project",
    assignees: [],
    ...overrides,
  };
}

describe("F237 TimelineScale (AS-457, AS-458)", () => {
  it("test_AS_457_the_today_line_renders_when_today_falls_inside_the_visible_range", () => {
    render(
      <TimelineScale rangeStart="2026-08-01" rangeEnd="2026-08-31" today="2026-08-15" pixelsPerDay={32} />,
    );
    const line = screen.getByTestId("timeline-today-line");
    expect(line).toBeInTheDocument();
    expect(line).toHaveAttribute("aria-label", "Today: 2026-08-15");
  });

  it("test_AS_457_no_today_line_renders_when_today_falls_outside_the_visible_range", () => {
    render(
      <TimelineScale rangeStart="2026-08-01" rangeEnd="2026-08-31" today="2026-09-15" pixelsPerDay={32} />,
    );
    expect(screen.queryByTestId("timeline-today-line")).not.toBeInTheDocument();
  });

  it("test_AS_458_the_scale_header_has_an_explicit_pixel_width_matching_its_own_day_count_so_it_scrolls_in_lockstep_with_rows", () => {
    render(
      <TimelineScale rangeStart="2026-08-01" rangeEnd="2026-08-31" today={null} pixelsPerDay={10} />,
    );
    const scale = screen.getByTestId("timeline-scale");
    // 31 days * 10px.
    expect(scale.style.width).toBe("310px");
  });
});

describe("F237 TimelineBar (AS-451, AS-452)", () => {
  it("test_AS_451_a_task_with_both_dates_renders_as_a_range_bar_with_its_title_visible", () => {
    const task = makeTask();
    const layout = computeBarLayout(task, "2026-08-01", "2026-08-31", 10)!;
    render(<TimelineBar task={task} layout={layout} workspaceSlug="acme" />);
    const bar = screen.getByTestId("timeline-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveTextContent("Ship the timeline");
    expect(bar).toHaveAttribute("href", "/w/acme/projects/project-1/board?taskId=task-1");
  });

  it("test_AS_452_a_task_without_a_start_date_renders_as_a_single_day_marker_not_a_range_bar", () => {
    const task = makeTask({ startDate: null, dueDate: "2026-08-12" });
    const layout = computeBarLayout(task, "2026-08-01", "2026-08-31", 10)!;
    render(<TimelineBar task={task} layout={layout} workspaceSlug="acme" />);
    expect(screen.getByTestId("timeline-marker")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-bar")).not.toBeInTheDocument();
  });
});
