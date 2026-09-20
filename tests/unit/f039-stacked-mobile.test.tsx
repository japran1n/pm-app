// @vitest-environment jsdom
// F039 (AS-082): on mobile viewports (<=640px) the stacked planner must
// remain usable -- rows scroll vertically, columns don't cause horizontal
// page overflow.

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { StackedPlanner } from "@/components/calendar/stacked-planner";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";

const ALICE_ID = "alice-id";

const ALICE_MEMBER: SwitcherMember = {
  userId: ALICE_ID,
  name: "Alice Anders",
  email: "alice@example.com",
  avatarUrl: null,
};

describe("F039 stacked planner mobile pass", () => {
  afterEach(() => {
    cleanup();
  });

  it("test_AS_082_stacked_planner_no_horizontal_overflow", () => {
    render(
      <div style={{ width: "375px" }}>
        <StackedPlanner
          selectedUserIds={[ALICE_ID]}
          blocksByUser={new Map<string, CalendarBlock[]>()}
          weekKey="2026-09-14"
          members={[ALICE_MEMBER]}
        />
      </div>,
    );

    const planner = screen.getByTestId("stacked-planner");
    // Rows scroll vertically (inherited from AS-068).
    expect(planner.className).toMatch(/overflow-y-auto/);
    // AS-082: the outer scroll container must not leave overflow-x as the
    // default "visible" -- it must explicitly hide or scroll horizontally.
    expect(planner.className).toMatch(/overflow-x-(hidden|auto|scroll)/);

    // Source check: no fixed wide min-widths on day columns that would
    // overflow a 375px mobile viewport.
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/calendar/stacked-person-row.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/min-w-\[(?:[5-9]\d{2}|[1-9]\d{3})px\]/);

    const plannerSrc = fs.readFileSync(
      path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
      "utf-8",
    );
    expect(plannerSrc).not.toMatch(/min-w-\[(?:[5-9]\d{2}|[1-9]\d{3})px\]/);
  });

  it("test_AS_082_planner_header_mobile_wraps", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/calendar/planner-header.tsx"),
      "utf-8",
    );
    // The header container must either flex-wrap or be scrollable
    // It must not use flex-nowrap without an overflow-x-auto escape
    const hasWrap = /flex-wrap/.test(src);
    const hasOverflowAuto = /overflow-x-auto/.test(src);
    expect(hasWrap || hasOverflowAuto).toBe(true);
  });
});
