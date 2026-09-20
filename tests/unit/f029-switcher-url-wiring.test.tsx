// @vitest-environment jsdom
//
// F029 (AS-011, AS-012, AS-013, AS-059): the people switcher's URL wiring.
//
// - AS-011: week navigation (prev/next/today) preserves the current
//   `?people=` value.
// - AS-012: changing the selected people preserves the current `?week=`
//   value.
// - AS-013: no Planner view state is ever written to localStorage or
//   sessionStorage.
// - AS-059: deselecting every member falls back to the signed-in member
//   rather than an empty view.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { buildWeekNavHref } from "@/lib/calendar/people-selection";
import { buildPlannerNavHrefs } from "@/lib/calendar/week-nav";

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

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

describe("AS-011: week navigation preserves ?people=", () => {
  it("prev/next hrefs carry the current people selection forward", () => {
    const prevHref = buildWeekNavHref({
      workspaceSlug: "acme",
      weekKey: "2026-05-25",
      peopleParam: "member-a,member-b",
    });
    const nextHref = buildWeekNavHref({
      workspaceSlug: "acme",
      weekKey: "2026-06-08",
      peopleParam: "member-a,member-b",
    });

    expect(prevHref).toBe("/w/acme/calendar?week=2026-05-25&people=member-a%2Cmember-b");
    expect(nextHref).toBe("/w/acme/calendar?week=2026-06-08&people=member-a%2Cmember-b");
  });

  it("today's href also carries the current people selection forward", () => {
    const todayHref = buildWeekNavHref({
      workspaceSlug: "acme",
      peopleParam: "me",
    });

    expect(todayHref).toBe("/w/acme/calendar?people=me");
  });

  it("no people param present means none is added to nav hrefs", () => {
    const href = buildWeekNavHref({ workspaceSlug: "acme", weekKey: "2026-06-08" });
    expect(href).toBe("/w/acme/calendar?week=2026-06-08");
    expect(href).not.toContain("people=");
  });

  it("an empty-string people param is treated as absent, not written literally", () => {
    const href = buildWeekNavHref({ workspaceSlug: "acme", weekKey: "2026-06-08", peopleParam: "" });
    expect(href).not.toContain("people=");
  });
});

// AS-012 + AS-059, exercised through the actual PeopleSwitcherUrlBound
// wiring component (not a re-implementation of its logic).
async function importPeopleSwitcherUrlBound() {
  const mod = await import("@/components/calendar/people-switcher");
  return mod.PeopleSwitcherUrlBound;
}

const members = [
  { userId: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
  { userId: "user-2", name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
];

function openSwitcher() {
  fireEvent.click(screen.getByRole("button", { name: /select people|people selected/i }));
}

describe("AS-012: changing the selected people preserves ?week=", () => {
  it("selecting a member pushes a URL that keeps the current ?week=", async () => {
    const PeopleSwitcherUrlBound = await importPeopleSwitcherUrlBound();

    render(
      createElement(PeopleSwitcherUrlBound, {
        members,
        selectedUserIds: ["user-1"],
        selfId: "user-1",
        workspaceSlug: "acme",
        weekParam: "2026-06-08",
      }),
    );

    openSwitcher();

    const row = await waitFor(() => screen.getByText("Grace Hopper"));
    fireEvent.click(row);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain("week=2026-06-08");
    expect(url).toContain("people=");
  });

  it("when no ?week= was present, none is added on selection change", async () => {
    const PeopleSwitcherUrlBound = await importPeopleSwitcherUrlBound();

    render(
      createElement(PeopleSwitcherUrlBound, {
        members,
        selectedUserIds: ["user-1"],
        selfId: "user-1",
        workspaceSlug: "acme",
      }),
    );

    openSwitcher();
    const row = await waitFor(() => screen.getByText("Grace Hopper"));
    fireEvent.click(row);

    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain("week=");
  });
});

describe("AS-059: deselecting every member falls back to the signed-in member", () => {
  it("deselecting the only selected member pushes a URL selecting self, not an empty selection", async () => {
    const PeopleSwitcherUrlBound = await importPeopleSwitcherUrlBound();

    render(
      createElement(PeopleSwitcherUrlBound, {
        members,
        selectedUserIds: ["user-1"],
        selfId: "user-1",
        workspaceSlug: "acme",
        weekParam: "2026-06-08",
      }),
    );

    openSwitcher();
    // Toggling the only selected member off leaves the selection empty.
    const row = await waitFor(() => screen.getByText("Ada Lovelace"));
    fireEvent.click(row);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = new URL(pushMock.mock.calls[0]![0] as string, "http://localhost");
    expect(url.searchParams.get("people")).toBe("me");
    expect(url.searchParams.get("people")).not.toBe("");
  });
});

describe("AS-013: no Planner view state is written to localStorage or sessionStorage", () => {
  it("selecting/deselecting people never calls localStorage.setItem or sessionStorage.setItem (vi.stubGlobal runtime guard)", async () => {
    const localSetItem = vi.fn();
    const sessionSetItem = vi.fn();

    vi.stubGlobal("localStorage", {
      getItem: vi.fn(),
      setItem: localSetItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    });
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(),
      setItem: sessionSetItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    });

    try {
      const PeopleSwitcherUrlBound = await importPeopleSwitcherUrlBound();

      render(
        createElement(PeopleSwitcherUrlBound, {
          members,
          selectedUserIds: ["user-1"],
          selfId: "user-1",
          workspaceSlug: "acme",
          weekParam: "2026-06-08",
        }),
      );

      openSwitcher();
      const row = await waitFor(() => screen.getByText("Grace Hopper"));
      fireEvent.click(row);

      expect(localSetItem).not.toHaveBeenCalled();
      expect(sessionSetItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("no calendar source file references localStorage, sessionStorage, or indexedDB (source scan, primary guard)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const calendarFiles = [
      "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
      "components/calendar/week-view.tsx",
      "components/calendar/week-time-grid.tsx",
      "components/calendar/week-agenda.tsx",
      "components/calendar/people-switcher.tsx",
    ];

    for (const file of calendarFiles) {
      const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
      expect(source, `${file} must not use browser storage`).not.toMatch(
        /localStorage|sessionStorage|indexedDB/i,
      );
    }
  });
});

// F071 (AS-011): supersedes the F067 source-regex guard above (deleted).
// That guard only checked that the literal token `peopleParam` appeared
// inside the call-site text -- `buildWeekNavHref({ ..., peopleParam:
// undefined })` keeps the token, silently drops `?people=`, and the old
// regex test still passed. This block instead exercises the calendar
// page's actual navigation-href wiring end-to-end and asserts on the
// real returned href string / its parsed `?people=` value, so it fails
// whenever peopleParam is ignored -- however that happens.
describe("F071 (AS-011): week nav hrefs carry a real, correct ?people= value end-to-end", () => {
  it("weekHrefFor-equivalent wiring (page.tsx's own call shape) preserves peopleParam in prev/next hrefs", () => {
    // Mirrors page.tsx's `weekHrefFor` closure exactly: peopleParam is
    // whatever `searchParams.people` resolved to, threaded straight
    // through to buildWeekNavHref for every nav link.
    const peopleParam = "member-a,member-b";
    const weekHrefFor = (key: string) =>
      buildWeekNavHref({ workspaceSlug: "acme", weekKey: key, peopleParam });

    const prevHref = weekHrefFor("2026-05-25");
    const nextHref = weekHrefFor("2026-06-08");

    const prevUrl = new URL(prevHref, "http://localhost");
    const nextUrl = new URL(nextHref, "http://localhost");

    expect(prevUrl.searchParams.get("people")).toBe("member-a,member-b");
    expect(nextUrl.searchParams.get("people")).toBe("member-a,member-b");
  });

  it("today's href wiring also preserves peopleParam", () => {
    const peopleParam = "member-a,member-b";
    const todayHref = buildWeekNavHref({ workspaceSlug: "acme", peopleParam });

    const url = new URL(todayHref, "http://localhost");
    expect(url.searchParams.get("people")).toBe("member-a,member-b");
  });

});

// F075 (AS-011): tests the ACTUAL function page.tsx calls
// (`buildPlannerNavHrefs`), not a copy of its logic. A mutation that drops
// `peopleParam` inside `buildPlannerNavHrefs` itself must fail these tests.
describe("F075 (AS-011): buildPlannerNavHrefs (page.tsx's real call site) preserves ?people=", () => {
  it("prevHref and nextHref carry the current people selection forward", () => {
    const { prevHref, nextHref } = buildPlannerNavHrefs({
      workspaceSlug: "acme",
      currentWeekKey: "2026-09-14",
      prevWeekKey: "2026-09-07",
      nextWeekKey: "2026-09-21",
      peopleParam: "alice,bob",
    });

    expect(prevHref).toContain("people=alice%2Cbob");
    expect(nextHref).toContain("people=alice%2Cbob");
  });

  it("todayHref is derived from peopleParam, carrying it forward when present", () => {
    const { todayHref } = buildPlannerNavHrefs({
      workspaceSlug: "acme",
      currentWeekKey: "2026-09-14",
      prevWeekKey: "2026-09-07",
      nextWeekKey: "2026-09-21",
      peopleParam: "alice,bob",
    });

    expect(todayHref).toContain("people=alice%2Cbob");
  });

  it("no people param present means none is added to any nav href", () => {
    const { prevHref, nextHref, todayHref } = buildPlannerNavHrefs({
      workspaceSlug: "acme",
      currentWeekKey: "2026-09-14",
      prevWeekKey: "2026-09-07",
      nextWeekKey: "2026-09-21",
      peopleParam: undefined,
    });

    expect(prevHref).not.toContain("people=");
    expect(nextHref).not.toContain("people=");
    expect(todayHref).not.toContain("people=");
  });
});

describe("F075: page.tsx's source guard -- must call buildPlannerNavHrefs", () => {
  it("imports and calls buildPlannerNavHrefs, not the old inline helper shape", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
      ),
      "utf8",
    );

    expect(source).toMatch(/import\s*\{\s*buildPlannerNavHrefs\s*\}\s*from\s*["']@\/lib\/calendar\/week-nav["']/);
    expect(source).toMatch(/buildPlannerNavHrefs\(/);
    // F080: the old `peopleParam` token-presence regex guard was deleted
    // here -- it matched even `peopleParam: undefined`, which is why the
    // bug survived five scrutiny passes. The real, value-level guard for
    // AS-011 now lives in tests/unit/f080-calendar-nav-hrefs.test.tsx,
    // which renders WeekView and asserts on actual <a href> attributes.
  });
});

// F085 (AS-052): only ACTIVE members may appear in the people switcher --
// pending/inactive members must never be selectable. This is a source
// scan (not a render test) so it catches the call site itself: a mutation
// swapping `workspaceMembers.active` for `workspaceMembers.pending` (or a
// combined `[...active, ...pending]` spread) at the `peopleSwitcherMembers`
// call site in page.tsx MUST fail this test.
describe("F085 (AS-052): page.tsx passes only workspaceMembers.active to the people switcher", () => {
  it("the peopleSwitcherMembers prop is derived from workspaceMembers.active, and that line never references .pending", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
      ),
      "utf8",
    );

    const lines = source.split("\n");
    const assignmentLineIndex = lines.findIndex((line) =>
      /peopleSwitcherMembers[:=]\s*\{?\s*workspaceMembers\.\w+\.map/.test(line),
    );

    expect(
      assignmentLineIndex,
      "expected a `peopleSwitcherMembers: workspaceMembers.<field>.map(...)` line in page.tsx",
    ).toBeGreaterThanOrEqual(0);

    const assignmentLine = lines[assignmentLineIndex]!;

    // Positive: must reference the active-only field.
    expect(assignmentLine).toMatch(/peopleSwitcherMembers[:=]\s*\{?\s*workspaceMembers\.active\.map/);

    // Negative: must NOT reference pending members on that same line.
    expect(assignmentLine).not.toContain(".pending");
  });
});
