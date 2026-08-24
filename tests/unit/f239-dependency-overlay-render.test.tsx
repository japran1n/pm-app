// @vitest-environment jsdom
//
// F239 (AS-455) component-level render guard -- proves the connector
// markup is actually present from real typed props, mirroring
// tests/unit/f237-timeline-render.test.tsx's own shape.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DependencyOverlay } from "@/components/timeline/dependency-overlay";
import { computeBarLayout, type TimelineBarLayout } from "@/lib/timeline/layout";

afterEach(cleanup);

const rangeStart = "2026-08-01";
const rangeEnd = "2026-08-31";
const pixelsPerDay = 10;

function barFor(id: string, startDate: string | null, dueDate: string | null): TimelineBarLayout {
  return computeBarLayout({ id, startDate: startDate as never, dueDate: dueDate as never }, rangeStart, rangeEnd, pixelsPerDay)!;
}

describe("F239 DependencyOverlay (AS-455)", () => {
  it("test_AS_455_a_dependency_between_two_rendered_bars_renders_a_connector_path", () => {
    const blockingBar = barFor("blocking", "2026-08-01", "2026-08-05");
    const blockedBar = barFor("blocked", "2026-08-10", "2026-08-15");
    render(
      <DependencyOverlay
        edges={[{ id: "dep-1", blockingTaskId: "blocking", blockedTaskId: "blocked" }]}
        rowPositions={new Map([["blocking", 40], ["blocked", 88]])}
        barLayouts={new Map([["blocking", blockingBar], ["blocked", blockedBar]])}
        widthPx={310}
        heightPx={136}
      />,
    );
    const overlay = screen.getByTestId("timeline-dependency-overlay");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    const connector = screen.getByTestId("timeline-dependency-connector");
    expect(connector).toHaveAttribute("data-dependency-id", "dep-1");
  });

  it("test_AS_455_negative_no_overlay_renders_when_the_other_endpoint_is_invisible_or_unrendered", () => {
    const blockingBar = barFor("blocking", "2026-08-01", "2026-08-05");
    render(
      <DependencyOverlay
        // The blocked task simply isn't present in either map -- the
        // exact shape a private-project (invisible) or off-screen/
        // date-less endpoint takes once it never made it into the
        // caller's own visible task set (see getTimelineDependencyEdges'
        // doc comment) or the rendered row set.
        edges={[{ id: "dep-2", blockingTaskId: "blocking", blockedTaskId: "invisible" }]}
        rowPositions={new Map([["blocking", 40]])}
        barLayouts={new Map([["blocking", blockingBar]])}
        widthPx={310}
        heightPx={88}
      />,
    );
    // No overlay element at all -- not merely an empty one -- so nothing
    // in the DOM even hints a dependency exists.
    expect(screen.queryByTestId("timeline-dependency-overlay")).not.toBeInTheDocument();
    expect(screen.queryByText(/invisible/i)).not.toBeInTheDocument();
  });
});
