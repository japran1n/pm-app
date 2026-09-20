// F031 (AS-001, AS-002, AS-014, AS-023, AS-015): the Planner page derives
// its layout ("week-grid" vs "stacked") purely from how many people are
// selected, never from a "?view=" query param. These tests exercise the
// pure logic (resolvePlannerLayout, parsePeopleParam) that page.tsx
// composes, plus source-level checks against page.tsx itself -- server
// component RSC rendering isn't exercised directly here, matching the
// project's convention for this route (see f012-slug-validation.test.ts).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";
import { parsePeopleParam } from "@/lib/calendar/people-selection";

const PAGE_PATH = path.join(
  process.cwd(),
  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
);

function readPageSource(): string {
  return readFileSync(PAGE_PATH, "utf8");
}

describe("resolvePlannerLayout", () => {
  it("test_AS_001_no_selection_defaults_to_week_grid_layout", () => {
    // No params -> selection is just the signed-in member -> week-grid.
    expect(resolvePlannerLayout(1)).toBe("week-grid");
  });

  it("test_AS_023_single_person_selection_returns_week_grid_not_stacked", () => {
    // Narrowing from a stacked selection back to one person must return
    // the full-day week grid, not stay stacked.
    expect(resolvePlannerLayout(1)).toBe("week-grid");
  });

  it("test_stacked_layout_for_two_or_more_people", () => {
    expect(resolvePlannerLayout(2)).toBe("stacked");
    expect(resolvePlannerLayout(5)).toBe("stacked");
  });

  it("test_zero_selection_still_resolves_to_week_grid", () => {
    expect(resolvePlannerLayout(0)).toBe("week-grid");
  });
});

describe("parsePeopleParam default selection (AS-001, AS-002)", () => {
  const selfId = "user-self";
  const activeMemberIds = [selfId, "user-a", "user-b"];

  it("test_AS_001_no_people_param_selects_only_the_signed_in_member", () => {
    const selected = parsePeopleParam(undefined, { selfId, activeMemberIds });
    expect(selected).toEqual([selfId]);
  });

  it("test_AS_002_no_params_selection_of_one_resolves_to_week_grid_full_day_layout", () => {
    // AS-002's "full-day week grid" is WeekView's own default render for a
    // single-person selection; here we assert the layout that page.tsx
    // will pick for that selection is "week-grid" (the layout WeekView
    // renders as the full 24h/7-day grid), not "stacked".
    const selected = parsePeopleParam(undefined, { selfId, activeMemberIds });
    expect(resolvePlannerLayout(selected.length)).toBe("week-grid");
  });
});

describe("AS-014: same URL renders identically for another member with the same rights", () => {
  it("test_AS_014_same_people_param_resolves_to_same_selection_for_any_caller", () => {
    // The page is server-rendered purely from the URL + the caller's own
    // active-member allowlist -- for two different signed-in callers with
    // the same access rights (same activeMemberIds), the same "?people="
    // value resolves to the identical ordered selection.
    const activeMemberIds = ["user-a", "user-b", "user-c"];
    const peopleParam = "user-a,user-b";

    const selectionForCallerA = parsePeopleParam(peopleParam, {
      selfId: "user-a",
      activeMemberIds,
    });
    const selectionForCallerB = parsePeopleParam(peopleParam, {
      selfId: "user-b",
      activeMemberIds,
    });

    expect(selectionForCallerA).toEqual(["user-a", "user-b"]);
    expect(selectionForCallerB).toEqual(["user-a", "user-b"]);
    expect(selectionForCallerA).toEqual(selectionForCallerB);
    // And the derived layout is identical too.
    expect(resolvePlannerLayout(selectionForCallerA.length)).toBe(
      resolvePlannerLayout(selectionForCallerB.length),
    );
  });
});

describe("AS-015: the page never reads a ?view= param", () => {
  it("test_AS_015_page_source_does_not_reference_searchParams_view", () => {
    const source = readPageSource();
    expect(source).not.toMatch(/searchParams\.view/);
    expect(source).not.toMatch(/\bview\s*:\s*string/); // no `view` field on the searchParams type
    expect(source).not.toMatch(/params\.view\b/);
  });

  it("test_AS_015_page_source_derives_layout_only_from_resolvePlannerLayout", () => {
    const source = readPageSource();
    expect(source).toMatch(/resolvePlannerLayout\(/);
  });
});

describe("AS-001: the page fetches blocks for the selected people, not every member", () => {
  it("test_AS_001_page_passes_selectedUserIds_as_blockUserIds_not_all_members", () => {
    const source = readPageSource();
    // The fix for the AS-059 caveat: blockUserIds must come from the
    // parsed selection, not from every active workspace member.
    expect(source).toMatch(/blockUserIds=\{selectedUserIds\}/);
    expect(source).not.toMatch(
      /blockUserIds=\{workspaceMembers\.active\.map/,
    );
  });
});
