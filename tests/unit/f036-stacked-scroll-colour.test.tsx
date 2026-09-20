// @vitest-environment jsdom
//
// F036 (AS-067, AS-068, AS-069): stacked planner blocks keep their own
// colour, the stacked container scrolls instead of compressing rows, and
// hours/capacity/utilisation text never appears in either stacked file.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StackedPersonRow } from "@/components/calendar/stacked-person-row";
import { StackedPlanner } from "@/components/calendar/stacked-planner";
import { PlannerHeader } from "@/components/calendar/planner-header";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/w/test/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  cleanup();
});

const WEEK_KEY = "2026-09-14";

function makeBlock(overrides: Partial<CalendarBlock>): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "ws-1",
    projectId: null,
    userId: "user-1",
    title: "Test block",
    startsAt: "2026-09-14T09:00:00Z",
    endsAt: "2026-09-14T10:00:00Z",
    color: "#3366ff",
    blockType: "general",
    ...overrides,
  };
}

const plannerSource = readFileSync(
  path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
  "utf8",
);
describe("F036 stacked planner colour + scroll", () => {
  it("AS-067: a block chip renders with its own `color` field, not a substituted per-person colour", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        userLabel="Alice"
        blocks={[makeBlock({ id: "block-red", color: "#ef4444" })]}
        weekKey={WEEK_KEY}
      />,
    );

    const chip = screen.getByTestId("stacked-block-block-red-1");
    // Background is the block's own color at ~10% alpha; border is the
    // block's own color at full opacity -- both derived from block.color,
    // never a hardcoded/person-level color.
    expect(chip).toHaveStyle({ borderColor: "#ef4444" });
    expect(chip.getAttribute("style")).toContain("239, 68, 68");
  });

  it("AS-067: two different blocks in the same row render two different colours", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        userLabel="Alice"
        blocks={[
          makeBlock({
            id: "block-red",
            color: "#ef4444",
            startsAt: "2026-09-14T09:00:00Z",
            endsAt: "2026-09-14T10:00:00Z",
          }),
          makeBlock({
            id: "block-green",
            color: "#22c55e",
            startsAt: "2026-09-14T11:00:00Z",
            endsAt: "2026-09-14T12:00:00Z",
          }),
        ]}
        weekKey={WEEK_KEY}
      />,
    );

    const red = screen.getByTestId("stacked-block-block-red-1");
    const green = screen.getByTestId("stacked-block-block-green-1");
    expect(red).toHaveStyle({ borderColor: "#ef4444" });
    expect(green).toHaveStyle({ borderColor: "#22c55e" });
  });

  it("AS-068: stacked-planner.tsx scroll container uses overflow-y-auto (or overflow-y: auto)", () => {
    const hasOverflowAuto =
      /overflow-y-auto/.test(plannerSource) ||
      /overflow-y:\s*auto/.test(plannerSource);
    expect(hasOverflowAuto).toBe(true);
  });

  it("AS-068: stacked-planner.tsx scroll container has a fixed/max height, not a bare flex compress", () => {
    const hasMaxHeight = /max-h-\[/.test(plannerSource) || /maxHeight/.test(plannerSource);
    expect(hasMaxHeight).toBe(true);
  });

  it("test_AS_069_no_capacity_figure_in_any_planner_file", () => {
    const candidateFiles = [
      "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
      "components/calendar/planner-header.tsx",
      "components/calendar/stacked-planner.tsx",
      "components/calendar/stacked-person-row.tsx",
      "components/calendar/week-view.tsx",
      "components/calendar/week-time-grid.tsx",
      "components/calendar/people-switcher.tsx",
      "components/calendar/week-agenda.tsx",
      "components/calendar/calendar-block-chip.tsx",
      "components/calendar/time-off-day-strip.tsx",
    ];

    const plannerFiles = candidateFiles.filter((file) =>
      existsSync(path.join(process.cwd(), file)),
    );

    const capacityPatterns = [
      /\d+\s*h\s*(total|·|\/)/i, // "32h total" or "32h · " or "32h / 40h"
      /\d+\s+hours?\b/i, // "12 hours"
      /\d+\s*\/\s*\d+\s*hrs?\b/i, // "8 / 40 hrs"
      /utilis[ae]tion/i, // "utilisation" or "utilization"
      /capacity/i,
      /\d+%\s*(load|utilis|capac)/i, // "80% load" or "80% utilisation"
      /load\s*:\s*\d/i, // "load: 80"
      /\bh\s*·\s*\d+%/i, // "32h · 80%"
      /\b\d+\s*h\s+(total|booked|load|available|utili|spent|work)/i, // bare "40h booked"
      /\b\d+\s*%\s+(booked|load|utili|capacity|total)/i, // bare "80% booked"
      /booked\s*:\s*\d/i, // "booked: 8"
    ];

    for (const file of plannerFiles) {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      // Strip comments
      const stripped = src
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const pattern of capacityPatterns) {
        expect(
          stripped,
          `${file} must not contain capacity figure matching ${pattern}`,
        ).not.toMatch(pattern);
      }
    }
  });

  // F106: the source-text sweep above is not falsifiable against template
  // literals like `${bookedHours}h total` -- the digit only exists at
  // runtime, so the regex never sees it in the static source. These two
  // tests render the real components and assert on actual DOM textContent,
  // which a mutation that interpolates a capacity figure at render time
  // cannot escape.
  it("test_AS_069_no_capacity_figure_rendered_in_planner_header", () => {
    render(
      <PlannerHeader
        rangeLabel="Sep 15 – Sep 19, 2026"
        workspaceSlug="test"
        workspaceId="workspace-1"
        prevHref="/w/test/calendar?week=2026-W37"
        nextHref="/w/test/calendar?week=2026-W39"
        todayHref="/w/test/calendar"
        peopleSwitcher={{
          members: [
            { userId: "u1", name: "Alice", email: "alice@example.com", avatarUrl: null },
            { userId: "u2", name: "Bob", email: "bob@example.com", avatarUrl: null },
          ],
          selectedUserIds: ["u1", "u2"],
          selfId: "u1",
          weekParam: "2026-W38",
        }}
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d+\s*h\s*(total|booked|·)/i);
    expect(text).not.toMatch(/utili[sz]ation/i);
    expect(text).not.toMatch(/capacity/i);
    expect(text).not.toMatch(/\d+%\s*(load|booked|capacity)/i);
  });

  it("test_AS_069_no_capacity_figure_rendered_in_stacked_row", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        userLabel="Alice"
        blocks={[
          makeBlock({
            id: "block-1",
            startsAt: "2026-09-14T09:00:00Z",
            endsAt: "2026-09-14T17:00:00Z",
          }),
        ]}
        weekKey={WEEK_KEY}
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d+\s*h\s*(total|booked|·)/i);
    expect(text).not.toMatch(/utili[sz]ation/i);
    expect(text).not.toMatch(/capacity/i);
    expect(text).not.toMatch(/\d+%\s*(load|booked|capacity)/i);
  });

  // F107: the two tests above only render StackedPersonRow directly with a
  // single person, so a StackedPlanner-level bug that overwrites block.color
  // with a per-person palette color (e.g. `PERSON_PALETTE[i % 4]`) before
  // handing blocks down to each row would never be exercised. This test
  // renders the full StackedPlanner with two members whose blocks each have
  // a distinct, deliberately-non-palette color, and asserts each chip still
  // shows its own block.color -- never a color keyed off the person's index.
  it("test_AS_067_block_color_not_overridden_by_person_palette", () => {
    const members: SwitcherMember[] = [
      { userId: "alice", name: "Alice", email: "alice@example.com", avatarUrl: null },
      { userId: "bob", name: "Bob", email: "bob@example.com", avatarUrl: null },
    ];

    const aliceBlock = makeBlock({
      id: "b1",
      userId: "alice",
      color: "#ef4444", // red
      startsAt: "2026-09-14T09:00:00Z",
      endsAt: "2026-09-14T10:00:00Z",
    });
    const bobBlock = makeBlock({
      id: "b2",
      userId: "bob",
      color: "#22c55e", // green
      startsAt: "2026-09-14T09:00:00Z",
      endsAt: "2026-09-14T10:00:00Z",
    });

    render(
      <StackedPlanner
        selectedUserIds={["alice", "bob"]}
        members={members}
        blocksByUser={new Map([
          ["alice", [aliceBlock]],
          ["bob", [bobBlock]],
        ])}
        weekKey={WEEK_KEY}
        workspaceSlug="test"
        selfId="alice"
        weekParam="2026-W38"
      />,
    );

    const aliceChip = screen.getByTestId("stacked-block-b1-1");
    const bobChip = screen.getByTestId("stacked-block-b2-1");

    // Each block must render with ITS OWN color -- a person-indexed palette
    // override would make alice's chip use palette[0] and bob's chip use
    // palette[1], which would not match block.color here.
    expect(aliceChip).toHaveStyle({ borderColor: "#ef4444" });
    expect(bobChip).toHaveStyle({ borderColor: "#22c55e" });
    expect(aliceChip.getAttribute("style")).toContain("239, 68, 68");
    expect(bobChip.getAttribute("style")).toContain("34, 197, 94");
  });

  // F109: the render-level checks above only cover PlannerHeader and
  // StackedPersonRow individually. This renders the full StackedPlanner
  // (multi-member, with blocks, but no capacity data anywhere in props)
  // and asserts document.body.textContent never surfaces a capacity/hours
  // figure that a mutation could interpolate at render time.
  it("test_AS_069_no_capacity_figure_rendered_in_stacked_planner", () => {
    const members: SwitcherMember[] = [
      { userId: "alice", name: "Alice", email: "alice@example.com", avatarUrl: null },
      { userId: "bob", name: "Bob", email: "bob@example.com", avatarUrl: null },
    ];

    const aliceBlock = makeBlock({
      id: "b1",
      userId: "alice",
      color: "#ef4444",
      startsAt: "2026-09-14T09:00:00Z",
      endsAt: "2026-09-14T17:00:00Z",
    });
    const bobBlock = makeBlock({
      id: "b2",
      userId: "bob",
      color: "#22c55e",
      startsAt: "2026-09-14T09:00:00Z",
      endsAt: "2026-09-14T17:00:00Z",
    });

    render(
      <StackedPlanner
        selectedUserIds={["alice", "bob"]}
        members={members}
        blocksByUser={new Map([
          ["alice", [aliceBlock]],
          ["bob", [bobBlock]],
        ])}
        weekKey={WEEK_KEY}
        workspaceSlug="test"
        selfId="alice"
        weekParam="2026-W38"
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d+\s*h(ours?)?\s*(total|·|\/|booked|load)/i);
    expect(text).not.toMatch(/utili[sz]ation/i);
    expect(text).not.toMatch(/capacity/i);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+\s*h/i);
    expect(text).not.toMatch(/\d+%\s*(load|booked|capacity|utili)/i);
  });

  // F110: the two AS-068 tests above only sweep the source text for the
  // substrings "overflow-y-auto" and "max-h-[" -- a mutation that swaps the
  // rendered className to `overflow-hidden` or `min-h-0` while leaving an
  // unrelated `max-h-[` comment/string elsewhere in the file would slip
  // past. This test renders the real component and asserts on the actual
  // DOM className of the scroll container and each row, which a rendered
  // class mutation cannot escape.
  it("test_AS_068_scroll_container_and_row_min_height", () => {
    const members: SwitcherMember[] = [
      { userId: "alice", name: "Alice", email: "alice@example.com", avatarUrl: null },
      { userId: "bob", name: "Bob", email: "bob@example.com", avatarUrl: null },
    ];

    render(
      <StackedPlanner
        selectedUserIds={["alice", "bob"]}
        members={members}
        blocksByUser={new Map()}
        weekKey={WEEK_KEY}
        workspaceSlug="test"
        selfId="alice"
        weekParam="2026-W38"
      />,
    );

    // Scroll container must render with overflow-y-auto, never
    // overflow-hidden -- short days must be able to scroll, not compress.
    const scrollContainer = screen.getByTestId("stacked-planner");
    expect(scrollContainer.className).toMatch(/overflow-y-auto/);
    expect(scrollContainer.className).not.toMatch(/overflow-hidden/);

    // Each per-person row must keep a fixed min-height and never shrink
    // below it -- min-h-0 would let short days compress the row away.
    const rows = [
      screen.getByTestId("stacked-person-row-alice"),
      screen.getByTestId("stacked-person-row-bob"),
    ];
    for (const row of rows) {
      expect(row.className).toMatch(/min-h-\[6rem\]/);
      expect(row.className).not.toMatch(/min-h-0/);
      expect(row.className).toMatch(/shrink-0/);
    }
  });
});
