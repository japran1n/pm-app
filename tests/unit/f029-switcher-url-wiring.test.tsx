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
  it("selecting/deselecting people never calls Storage.setItem", async () => {
    const setLocal = vi.spyOn(Storage.prototype, "setItem");
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

    expect(setLocal).not.toHaveBeenCalled();

    setLocal.mockRestore();
  });

  it("the people-switcher source never CALLS localStorage.*/sessionStorage.* (only doc-comment prose mentions them)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(process.cwd(), "components/calendar/people-switcher.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/\blocalStorage\s*\./);
    expect(source).not.toMatch(/\bsessionStorage\s*\./);
  });
});

describe("F067 (AS-011): calendar page.tsx call sites actually pass peopleParam to buildWeekNavHref", () => {
  it("both buildWeekNavHref(...) calls in page.tsx include the peopleParam wiring", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
      ),
      "utf8",
    );

    // Grab every buildWeekNavHref(...) call site (non-greedy, single-line
    // object-literal argument as used in page.tsx) and assert each one
    // carries `peopleParam` through -- either as the shorthand property
    // `peopleParam` or an explicit `peopleParam:` kwarg. If a future edit
    // drops it from either call site, this regex-per-call assertion fails
    // even though the isolated buildWeekNavHref unit tests above stay
    // green (they never touch page.tsx at all).
    const calls = [...source.matchAll(/buildWeekNavHref\(\{[^}]*\}\)/g)].map(
      (m) => m[0],
    );

    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call).toMatch(/\bpeopleParam\b/);
    }
  });
});
