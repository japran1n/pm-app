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
import { buildBlockUserIds } from "@/lib/calendar/workspace-members";

const PAGE_PATH = path.join(
  process.cwd(),
  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
);

function readPageSource(): string {
  return readFileSync(PAGE_PATH, "utf8");
}

// Strips `//` line comments and `/* ... */` block comments so JSDoc-style
// prose referencing "<PlannerHeader" or "layout ===" inside a comment can
// never satisfy the structural position check below.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
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

  it("test_AS_023_planner_header_rendered_once_above_the_layout_conditional", () => {
    // AS-023 is about JSX structure, not resolvePlannerLayout's return
    // value (that's already AS-001's own test above) -- assert
    // <PlannerHeader> is rendered exactly once in page.tsx, and that its
    // JSX appears BEFORE the "week-grid"/"stacked" layout conditional, so
    // it can never end up nested inside either branch (where it would
    // vanish whenever the other branch was picked).
    const source = stripComments(readPageSource());

    const headerMatches = [...source.matchAll(/<PlannerHeader\b/g)];
    expect(headerMatches).toHaveLength(1);

    const layoutConditionalMatch = source.match(
      /layout\s*===\s*["'](?:stacked|week-grid)["']/,
    );
    expect(layoutConditionalMatch).not.toBeNull();

    const headerIndex = headerMatches[0].index!;
    const layoutConditionalIndex = layoutConditionalMatch!.index!;

    expect(headerIndex).toBeLessThan(layoutConditionalIndex);
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

  it("test_AS_015_searchParams_type_does_not_destructure_a_view_field", () => {
    const source = readPageSource();
    // Type assertion: the searchParams Promise's object type must not
    // declare a `view` field alongside the known `week`/`people` fields --
    // this catches `{ week?: string; view?: string; people?: string }`
    // regardless of field ordering.
    expect(source).not.toMatch(
      /searchParams:\s*Promise<\{[^}]*\bview\??\s*:\s*string[^}]*\}>/,
    );
    // And the destructuring assignment pulled out of `await searchParams`
    // must not bind a `view` variable.
    const destructureMatch = source.match(
      /const\s*\{([^}]*)\}\s*=\s*await\s+searchParams;/,
    );
    expect(destructureMatch).not.toBeNull();
    const destructuredFields = destructureMatch![1];
    expect(destructuredFields).not.toMatch(/\bview\b/);
  });

  it("test_AS_015_page_source_derives_layout_only_from_resolvePlannerLayout", () => {
    const source = readPageSource();
    expect(source).toMatch(/resolvePlannerLayout\(/);
  });

  it("test_AS_015_resolvePlannerLayout_call_site_takes_no_view_argument", () => {
    const source = readPageSource();
    // Usage assertion: the call to resolvePlannerLayout must not reference
    // `view` anywhere in its argument list.
    const callMatch = source.match(/resolvePlannerLayout\(([^)]*)\)/);
    expect(callMatch).not.toBeNull();
    expect(callMatch![1]).not.toMatch(/view/);
    expect(callMatch![1]).toMatch(/selectedUserIds\.length/);
  });

  it("test_AS_015_resolvePlannerLayout_signature_only_accepts_a_number", () => {
    // Structural test: resolvePlannerLayout's own contract is a single
    // numeric selection count. A `?view=stacked` override could only ever
    // reach the derived layout by widening this signature to accept a
    // string/view-like value -- assert the function's real behavior
    // still comes purely from the numeric selection count, never from a
    // string such as "stacked" being passed straight through.
    expect(resolvePlannerLayout(1)).toBe("week-grid");
    expect(resolvePlannerLayout(2)).toBe("stacked");
    // @ts-expect-error -- resolvePlannerLayout must not accept a
    // view-like string argument at all; a mutation widening its
    // parameter type to accept `"stacked"` (e.g. `number | "stacked"`)
    // so a `?view=stacked` override could reach it would make this line
    // type-check, and TypeScript's `--noEmit` gate would then need the
    // `@ts-expect-error` directive above removed -- the signal that
    // AS-015 stopped holding.
    resolvePlannerLayout("stacked");
  });
});

describe("AS-001/AS-059: the page fetches blocks for the selected people, not every member", () => {
  // F090: a source regex on page.tsx (`blockUserIds={selectedUserIds}`)
  // stayed green even after a worker dropped the 4th argument from
  // getCalendarBlocks(...), because the regex never exercised the actual
  // data flowing into the query. This replaces it with a data-flow test on
  // the shared helper page.tsx is required to route through.
  it("test_AS_059_block_fetch_scoped_to_selection_not_all_members", () => {
    const result = buildBlockUserIds(["u1", "u2"]);
    expect(result).toEqual(["u1", "u2"]);
    // pending/other members not in the input must not appear
    expect(result).not.toContain("u3");
  });

  it("test_AS_001_page_source_routes_blockUserIds_through_buildBlockUserIds", () => {
    const source = readPageSource();
    // page.tsx must derive its `blockUserIds` prop from the shared helper,
    // not by inlining `selectedUserIds` or widening to every active member.
    expect(source).toMatch(/buildBlockUserIds\(selectedUserIds\)/);
    expect(source).toMatch(/blockUserIds=\{blockUserIds\}/);
    expect(source).not.toMatch(
      /blockUserIds=\{workspaceMembers\.active\.map/,
    );
  });

  it("test_AS_001_userIds_is_required_param", async () => {
    // F096: userIds must be a required parameter on getCalendarBlocks --
    // omitting it must be a compile error, so it can never silently mean
    // "no restriction" (AS-059) again. If this signature ever regresses to
    // optional, the @ts-expect-error below becomes an unused-directive
    // error and the suite fails. The resulting (unawaited) promise is
    // allowed to reject at runtime -- only the compile-time check matters
    // here, so the rejection is swallowed.
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");
    // @ts-expect-error — userIds is required; omitting it must be a compile error
    const pending = getCalendarBlocks("w1", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    await pending.catch(() => undefined);
  });
});
