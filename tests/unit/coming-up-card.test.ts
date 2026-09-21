// F009 (AS-060, AS-061): coming-up card renders up to 3 upcoming calendar
// blocks with a relative time label, and shows an explicit empty state when
// there is nothing scheduled. Rendered via react-dom/server (no jsdom
// needed) and asserted on the resulting HTML string, matching this repo's
// existing "pure server component" test convention.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import { ComingUpCard } from "@/components/dashboard/coming-up-card";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

function makeBlock(overrides: Partial<CalendarBlock>): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "ws-1",
    projectId: null,
    userId: "user-1",
    title: "Design review",
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    color: null,
    blockType: "general",
    ...overrides,
  };
}

describe("ComingUpCard", () => {
  it("test_AS_060_renders_up_to_three_upcoming_blocks", () => {
    const now = Date.now();
    const blocks: CalendarBlock[] = [
      makeBlock({ id: "b1", title: "Kickoff call", startsAt: new Date(now + 60 * 60 * 1000).toISOString(), endsAt: new Date(now + 90 * 60 * 1000).toISOString() }),
      makeBlock({ id: "b2", title: "Client presentation", blockType: "client_presentation", startsAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(), endsAt: new Date(now + 2 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString() }),
      makeBlock({ id: "b3", title: "Later block", startsAt: new Date(now + 20 * 24 * 60 * 60 * 1000).toISOString(), endsAt: new Date(now + 20 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString() }),
      makeBlock({ id: "b4", title: "Fourth block, should be excluded", startsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(), endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString() }),
    ];

    const html = renderToStaticMarkup(
      React.createElement(ComingUpCard, { blocks, workspaceSlug: "acme" }),
    );

    expect(html).toContain("Coming up");
    expect(html).toContain("Planner");
    expect(html).toContain("/w/acme/calendar");
    expect(html).toContain("Kickoff call");
    expect(html).toContain("Client presentation");
    expect(html).toContain("Later block");
    expect(html).not.toContain("Fourth block, should be excluded");
    expect(html).not.toContain("Nothing scheduled this week");
  });

  it("test_AS_061_renders_empty_state_when_nothing_scheduled", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingUpCard, { blocks: [], workspaceSlug: "acme" }),
    );

    expect(html).toContain("Nothing scheduled this week");
  });
});
