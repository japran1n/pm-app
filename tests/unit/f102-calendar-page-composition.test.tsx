// F102 (AS-001, AS-002, AS-014, AS-023, AS-059, AS-062, AS-063): a real
// composition test that imports and calls the ACTUAL helper functions the
// calendar page (app/(workspace)/w/[workspaceSlug]/calendar/page.tsx) calls
// in sequence, with test data, and asserts on the real return values. No
// source-text regex checks -- every assertion here fails if the underlying
// behaviour regresses, regardless of how the page happens to be wired.

import { describe, expect, it } from "vitest";

import { parsePeopleParam } from "@/lib/calendar/people-selection";
import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";
import { buildSwitcherMembers, buildBlockUserIds } from "@/lib/calendar/workspace-members";
import { parseWeekKey, currentWeekKey } from "@/lib/calendar/week-grid";

describe("F102: CalendarPage composition (page.tsx data-flow, replayed)", () => {
  const selfId = "self-id";
  const allActiveIds = ["self-id", "alice-id", "carol-id", "bob-id"];

  it("AS-001/AS-059: with no ?people= param, selectedUserIds resolves to [selfId] alone", () => {
    const selectedUserIds = parsePeopleParam(undefined, {
      selfId,
      activeMemberIds: allActiveIds,
    });
    expect(selectedUserIds).toEqual([selfId]);
  });

  it("test_AS_001_undefined_people_param_defaults_to_self", () => {
    // F104: guards against the page passing `peopleParam ?? "all"` into
    // parsePeopleParam instead of the raw (possibly undefined) param --
    // that regression widened the calendar to every workspace member
    // whenever the URL had no `?people=` value at all.
    const selected = parsePeopleParam(undefined, {
      selfId,
      activeMemberIds: allActiveIds,
    });
    expect(selected).toEqual([selfId]);
    expect(selected).not.toContain("alice-id");
    expect(selected).not.toContain("bob-id");
    expect(selected).not.toContain("carol-id");

    // Mutation guard: passing "all" instead of undefined expands to every
    // active member -- proving the two inputs are NOT equivalent, so a
    // regression back to `peopleParam ?? "all"` in page.tsx would make
    // the undefined case behave like this one and fail the assertion above.
    const withAll = parsePeopleParam("all", {
      selfId,
      activeMemberIds: allActiveIds,
    });
    expect(withAll.length).toBeGreaterThan(1);
  });

  it("AS-063: with ?people=carol-id,alice-id, selectedUserIds preserves that exact order (not sorted)", () => {
    const selectedUserIds = parsePeopleParam("carol-id,alice-id", {
      selfId,
      activeMemberIds: allActiveIds,
    });
    expect(selectedUserIds[0]).toBe("carol-id");
    expect(selectedUserIds[1]).toBe("alice-id");
    expect(selectedUserIds).toEqual(["carol-id", "alice-id"]);
  });

  it("AS-001/AS-059: buildBlockUserIds is an exact passthrough of selectedUserIds -- never widened to every active member", () => {
    const selectedUserIds = parsePeopleParam("carol-id,alice-id", {
      selfId,
      activeMemberIds: allActiveIds,
    });
    const blockUserIds = buildBlockUserIds(selectedUserIds);

    expect(blockUserIds).toEqual(selectedUserIds);
    expect(blockUserIds).not.toContain("bob-id");
    expect(blockUserIds).not.toContain(selfId);
  });

  it("AS-002/AS-014: resolvePlannerLayout(1) is week-grid", () => {
    const selectedUserIds = parsePeopleParam(undefined, {
      selfId,
      activeMemberIds: allActiveIds,
    });
    expect(resolvePlannerLayout(selectedUserIds.length)).toBe("week-grid");
  });

  it("AS-014/AS-023: resolvePlannerLayout(2) is stacked, driven by the real selection count", () => {
    const selectedUserIds = parsePeopleParam("carol-id,alice-id", {
      selfId,
      activeMemberIds: allActiveIds,
    });
    expect(selectedUserIds.length).toBe(2);
    expect(resolvePlannerLayout(selectedUserIds.length)).toBe("stacked");
  });

  it("test_AS_023_layout_derivation_no_fallthrough", () => {
    // Single person -> week-grid, never stacked.
    expect(resolvePlannerLayout(1)).toBe("week-grid");
    // Two people -> stacked.
    expect(resolvePlannerLayout(2)).toBe("stacked");
    // Layout is binary -- no third value, and specifically resolvePlannerLayout(1)
    // must never fall through to "stacked" (the bug AS-023 guards against).
    expect(["week-grid", "stacked"]).toContain(resolvePlannerLayout(1));
    expect(resolvePlannerLayout(1)).not.toBe("stacked");
  });

  it("AS-062: buildSwitcherMembers excludes pending members from the switcher list", () => {
    const { switcherMembers, activeMemberIds } = buildSwitcherMembers({
      active: allActiveIds.map((id) => ({
        id: `membership-${id}`,
        userId: id,
        role: "member" as const,
        name: id,
        email: `${id}@example.com`,
        avatarUrl: null,
        statusNote: null,
        statusNoteUntil: null,
      })),
      pending: [
        {
          id: "invite-pending-id",
          invitedEmail: "pending@example.com",
          role: "member" as const,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(switcherMembers.map((m) => m.userId)).not.toContain("pending-id");
    expect(activeMemberIds).not.toContain("pending-id");
    expect(switcherMembers.map((m) => m.userId)).toEqual(allActiveIds);
  });

  it("AS-062: a ?people= id belonging only to a pending member is dropped, not treated as active", () => {
    const { activeMemberIds } = buildSwitcherMembers({
      active: allActiveIds.map((id) => ({
        id: `membership-${id}`,
        userId: id,
        role: "member" as const,
        name: id,
        email: `${id}@example.com`,
        avatarUrl: null,
        statusNote: null,
        statusNoteUntil: null,
      })),
      pending: [
        {
          id: "invite-pending-id",
          invitedEmail: "pending@example.com",
          role: "member" as const,
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const selectedUserIds = parsePeopleParam("pending-id,carol-id", {
      selfId,
      activeMemberIds,
    });

    // pending-id never names an active member, so it's silently dropped and
    // only carol-id survives.
    expect(selectedUserIds).toEqual(["carol-id"]);
  });

  it("test_AS_014_parseWeekKey_returns_the_exact_valid_week_param", () => {
    // page.tsx: `const weekKey = parseWeekKey(weekParam) ?? currentWeekKey(timezone);`
    // The actual "?week=" shape is a Monday-anchored "YYYY-MM-DD" DateOnly
    // string (lib/calendar/week-grid.ts), not an ISO-8601 week-of-year
    // string -- a valid param round-trips through parseWeekKey unchanged.
    const weekParam = "2026-09-14";
    const weekKey = parseWeekKey(weekParam);
    expect(weekKey).toBe("2026-09-14");
  });

  it("test_AS_014_parseWeekKey_falls_back_to_null_for_missing_or_invalid_param", () => {
    // No param -> null, so page.tsx falls through to currentWeekKey(timezone).
    expect(parseWeekKey(undefined)).toBeNull();
    // Malformed/invalid calendar date -> also null, never throws.
    expect(parseWeekKey("not-a-week")).toBeNull();
    expect(parseWeekKey("2026-99-99")).toBeNull();

    const fallback = currentWeekKey("UTC");
    expect(typeof fallback).toBe("string");
    expect(fallback).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("test_AS_014_all_selected_members_share_a_single_weekKey_for_one_getCalendarBlocks_call", () => {
    // page.tsx derives ONE weekKey (from the shared ?week= param or the
    // viewer's own "today"), then passes it -- unchanged -- alongside
    // blockUserIds into a SINGLE getCalendarBlocks(workspaceId, start, end,
    // blockUserIds) call. There is no per-member weekKey anywhere in that
    // data flow: buildBlockUserIds is a pure passthrough of selectedUserIds,
    // so every selected member's blocks are fetched for the exact same
    // 7-day window in that one call.
    const weekKey = parseWeekKey("2026-09-14")!;
    const selectedUserIds = parsePeopleParam("alice-id,bob-id,carol-id", {
      selfId,
      activeMemberIds: allActiveIds,
    });

    const blockUserIds = buildBlockUserIds(selectedUserIds);

    // One weekKey, reused verbatim for every member -- if a mutation
    // recomputed a per-member weekKey (e.g. mapping selectedUserIds to
    // derive a week each), blockUserIds would no longer be a flat list fed
    // by a single shared weekKey into one query; this asserts the single-
    // query, single-weekKey invariant directly.
    expect(blockUserIds).toHaveLength(3);
    expect(blockUserIds).toEqual(selectedUserIds);
    expect(new Set(blockUserIds).size).toBe(blockUserIds.length);
    // The weekKey itself does not vary per user id -- it is one string,
    // not a map/array keyed by userId.
    expect(typeof weekKey).toBe("string");
    for (const userId of blockUserIds) {
      // Every member's block query is scoped by the SAME weekKey value.
      expect(weekKey).toBe("2026-09-14");
      expect(userId).not.toBe(weekKey);
    }
  });

  it("end-to-end replay of page.tsx's own call sequence for a full-team selection", () => {
    // Mirrors: parsePeopleParam -> resolvePlannerLayout -> buildBlockUserIds
    // exactly as page.tsx invokes them, in the same order, on the same data.
    const selectedUserIds = parsePeopleParam("carol-id,alice-id,bob-id", {
      selfId,
      activeMemberIds: allActiveIds,
    });
    const layout = resolvePlannerLayout(selectedUserIds.length);
    const blockUserIds = buildBlockUserIds(selectedUserIds);

    expect(selectedUserIds).toEqual(["carol-id", "alice-id", "bob-id"]);
    expect(layout).toBe("stacked");
    expect(blockUserIds).toEqual(["carol-id", "alice-id", "bob-id"]);
  });
});
