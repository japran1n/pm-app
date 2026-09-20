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
