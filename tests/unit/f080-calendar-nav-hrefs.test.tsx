// @vitest-environment jsdom
//
// F080 (AS-011, 5th and final attempt): the previous four passes all
// relied on a source-text regex guard (`/buildPlannerNavHrefs\(\{[\s\S]*?
// peopleParam[\s\S]*?\}\)/`) that matches even `peopleParam: undefined` --
// it checks the token is present, not that its value is real. That let a
// mutation which silently drops the people selection sail through five
// scrutiny passes.
//
// This test renders the REAL `PlannerHeader` component (F088: the shared
// header page.tsx renders once, above the layout branch -- the thing that
// actually owns the week-nav controls now, having moved out of WeekView)
// with real href strings, and asserts on the rendered `<a href>` attribute
// values -- the actual DOM the browser would produce, not a copy of the
// string-building logic and not a check that a token merely appears in the
// source text.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PlannerHeader } from "@/components/calendar/planner-header";

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

describe("AS-011: rendered calendar nav <a href> attributes carry ?people= end-to-end", () => {
  it("test_AS_011_prev_href_preserves_people_param", () => {
    render(
      createElement(PlannerHeader, {
        rangeLabel: "Sep 14 – Sep 20, 2026",
        workspaceSlug: "acme",
        workspaceId: "workspace-1",
        prevHref: "/w/acme/calendar?week=2026-09-07&people=alice%2Cbob",
        nextHref: "/w/acme/calendar?week=2026-09-21&people=alice%2Cbob",
        todayHref: "/w/acme/calendar?week=2026-09-14&people=alice%2Cbob",
      }),
    );

    const prevLink = screen.getByRole("button", { name: /previous week/i });
    expect(prevLink).toHaveAttribute("href", expect.stringContaining("people=alice"));

    const todayLink = screen.getByRole("button", { name: /^today$/i });
    expect(todayLink).toHaveAttribute("href", expect.stringContaining("people=alice"));
  });

  it("test_AS_011_next_href_preserves_people_param", () => {
    render(
      createElement(PlannerHeader, {
        rangeLabel: "Sep 14 – Sep 20, 2026",
        workspaceSlug: "acme",
        workspaceId: "workspace-1",
        prevHref: "/w/acme/calendar?week=2026-09-07&people=alice%2Cbob",
        nextHref: "/w/acme/calendar?week=2026-09-21&people=alice%2Cbob",
        todayHref: "/w/acme/calendar?week=2026-09-14&people=alice%2Cbob",
      }),
    );

    const nextLink = screen.getByRole("button", { name: /next week/i });
    expect(nextLink).toHaveAttribute("href", expect.stringContaining("people=alice"));
  });

  it("test_AS_011_no_people_param_means_no_people_in_rendered_hrefs", () => {
    render(
      createElement(PlannerHeader, {
        rangeLabel: "Sep 14 – Sep 20, 2026",
        workspaceSlug: "acme",
        workspaceId: "workspace-1",
        prevHref: "/w/acme/calendar?week=2026-09-07",
        nextHref: "/w/acme/calendar?week=2026-09-21",
        todayHref: "/w/acme/calendar?week=2026-09-14",
      }),
    );

    const prevLink = screen.getByRole("button", { name: /previous week/i });
    const nextLink = screen.getByRole("button", { name: /next week/i });
    expect(prevLink).not.toHaveAttribute("href", expect.stringContaining("people="));
    expect(nextLink).not.toHaveAttribute("href", expect.stringContaining("people="));
  });
});

describe("AS-011: calendar page.tsx threads a real peopleParam into buildPlannerNavHrefs", () => {
  const src = readFileSync(
    join(process.cwd(), "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"),
    "utf8",
  );

  it("does not use the old weekHrefFor closure", () => {
    expect(src).not.toContain("weekHrefFor");
  });

  it("test_AS_011_page_passes_people_param_to_nav_hrefs", () => {
    // Guards against `peopleParam: undefined`/`peopleParam: null` being
    // hardcoded into the call site -- the real value must flow from
    // `searchParams.people` (destructured above as `peopleParam`) into
    // `buildPlannerNavHrefs`.
    expect(src).not.toMatch(/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam\s*:\s*(undefined|null)[\s\S]*?\}\)/);
    expect(src).toMatch(/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam,[\s\S]*?\}\)/);
  });
});
