// F002/F003: lib/calendar/people-selection.ts parses the Planner's
// `?people=` URL param. This file covers F003's assertions (AS-007,
// AS-008) — the silent-drop-invalid-ids and fall-back-to-self behaviour —
// alongside baseline F002 coverage for the literals/order/dedupe rules
// that AS-007/AS-008 build on.

import { describe, expect, it } from "vitest";
import {
  orderPeopleForWholeTeam,
  parsePeopleParam,
  serializePeopleParam,
} from "@/lib/calendar/people-selection";

const SELF_ID = "member-self";
const ACTIVE_MEMBER_IDS = ["member-self", "member-a", "member-b", "member-c"];

describe("parsePeopleParam", () => {
  it("AS-007: an id that does not belong to an active workspace member is silently dropped, the rest still apply", () => {
    const result = parsePeopleParam("member-a,member-unknown,member-b", {
      selfId: SELF_ID,
      activeMemberIds: ACTIVE_MEMBER_IDS,
    });
    expect(result).toEqual(["member-a", "member-b"]);
    // never surfaces the bad id anywhere in the result
    expect(result).not.toContain("member-unknown");
  });

  it("AS-007: a single unknown id among otherwise-valid ids does not throw", () => {
    expect(() =>
      parsePeopleParam("member-unknown,member-c", {
        selfId: SELF_ID,
        activeMemberIds: ACTIVE_MEMBER_IDS,
      }),
    ).not.toThrow();
  });

  it("AS-008: when every id in ?people= is unknown/invalid, the parser falls back to [selfId]", () => {
    const result = parsePeopleParam("member-unknown,member-also-unknown", {
      selfId: SELF_ID,
      activeMemberIds: ACTIVE_MEMBER_IDS,
    });
    expect(result).toEqual([SELF_ID]);
  });

  it("AS-008: a single wholly-invalid id falls back to [selfId] rather than an empty list or error", () => {
    const result = parsePeopleParam("does-not-exist", {
      selfId: SELF_ID,
      activeMemberIds: ACTIVE_MEMBER_IDS,
    });
    expect(result).toEqual([SELF_ID]);
    expect(result.length).toBeGreaterThan(0);
  });

  it("AS-008: never returns an empty array, even for garbage input", () => {
    const result = parsePeopleParam(",,,", {
      selfId: SELF_ID,
      activeMemberIds: ACTIVE_MEMBER_IDS,
    });
    expect(result).toEqual([SELF_ID]);
  });

  // Baseline F002 coverage the F003 behaviours build on.

  it("AS-003: ?people=me resolves to the signed-in member", () => {
    expect(parsePeopleParam("me", { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS })).toEqual([
      SELF_ID,
    ]);
  });

  it("AS-004: ?people=all resolves to every active member of the workspace", () => {
    expect(
      parsePeopleParam("all", { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS }),
    ).toEqual(ACTIVE_MEMBER_IDS);
  });

  it("AS-004: ' all ' with whitespace resolves to all members", () => {
    expect(
      parsePeopleParam(" all ", { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS }),
    ).toEqual(ACTIVE_MEMBER_IDS);
  });

  it("AS-004: 'all,' with trailing comma resolves to all members", () => {
    expect(
      parsePeopleParam("all,", { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS }),
    ).toEqual(ACTIVE_MEMBER_IDS);
  });

  it("AS-008: all path with empty roster falls back to selfId", () => {
    expect(
      parsePeopleParam("all", { selfId: SELF_ID, activeMemberIds: [] }),
    ).toEqual([SELF_ID]);
  });

  it("AS-010: non-adjacent duplicate keeps first occurrence", () => {
    expect(
      parsePeopleParam("a,b,a", {
        selfId: "x",
        activeMemberIds: ["a", "b", "c"],
      }),
    ).toEqual(["a", "b"]);
  });

  it("AS-005: ?people=<memberId> shows only that member", () => {
    expect(
      parsePeopleParam("member-b", { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS }),
    ).toEqual(["member-b"]);
  });

  it("AS-006: a comma-separated list shows exactly those members", () => {
    expect(
      parsePeopleParam("member-c,member-a", {
        selfId: SELF_ID,
        activeMemberIds: ACTIVE_MEMBER_IDS,
      }),
    ).toEqual(["member-c", "member-a"]);
  });

  it("AS-009: the sequence of ids is preserved exactly as given, not alphabetised", () => {
    expect(
      parsePeopleParam("member-c,member-a,member-b", {
        selfId: SELF_ID,
        activeMemberIds: ACTIVE_MEMBER_IDS,
      }),
    ).toEqual(["member-c", "member-a", "member-b"]);
  });

  it("AS-010: an id repeated in ?people= produces exactly one selected person", () => {
    expect(
      parsePeopleParam("member-a,member-a,member-b", {
        selfId: SELF_ID,
        activeMemberIds: ACTIVE_MEMBER_IDS,
      }),
    ).toEqual(["member-a", "member-b"]);
  });

  it("AS-072 regression: order is NOT sorted — z,a,b input stays z,a,b, not a,b,z", () => {
    const activeIds = ["member-self", "uuid-z", "uuid-a", "uuid-b"];
    const result = parsePeopleParam("uuid-z,uuid-a,uuid-b", {
      selfId: SELF_ID,
      activeMemberIds: activeIds,
    });
    expect(result).toEqual(["uuid-z", "uuid-a", "uuid-b"]);
    expect(result).not.toEqual(["uuid-a", "uuid-b", "uuid-z"]);
  });

  it("AS-072 regression: all-invalid ids fall back to [selfId], never an empty array (builds on AS-008)", () => {
    const result = parsePeopleParam("bogus-1,bogus-2,bogus-3", {
      selfId: SELF_ID,
      activeMemberIds: ACTIVE_MEMBER_IDS,
    });
    expect(result).toEqual([SELF_ID]);
    expect(result).not.toEqual([]);
  });

  it("defaults to [selfId] when no param is present", () => {
    expect(
      parsePeopleParam(undefined, { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS }),
    ).toEqual([SELF_ID]);
    expect(
      parsePeopleParam(null, { selfId: SELF_ID, activeMemberIds: ACTIVE_MEMBER_IDS }),
    ).toEqual([SELF_ID]);
  });
});

describe("serializePeopleParam", () => {
  it("serializes a self-only selection as 'me'", () => {
    expect(serializePeopleParam([SELF_ID], SELF_ID)).toBe("me");
  });

  it("serializes a multi-person selection as a comma-joined, order-preserving string", () => {
    expect(serializePeopleParam(["member-c", "member-a"], SELF_ID)).toBe("member-c,member-a");
  });
});

describe("orderPeopleForWholeTeam", () => {
  it("AS-058: orders self first, then remaining members alphabetically by name", () => {
    const members = [
      { id: "b", name: "Bob" },
      { id: "a", name: "Alice" },
      { id: "self", name: "Zed" },
      { id: "c", name: "Charlie" },
    ];

    const result = orderPeopleForWholeTeam(members, "self");

    expect(result).toEqual(["self", "a", "b", "c"]);
  });

  it("AS-058: members with a null name sort last among the remainder", () => {
    const members = [
      { id: "n", name: null },
      { id: "a", name: "Alice" },
      { id: "self", name: "Self Person" },
    ];

    const result = orderPeopleForWholeTeam(members, "self");

    expect(result).toEqual(["self", "a", "n"]);
  });

  it("AS-058: self appears first even when self sorts last alphabetically", () => {
    const members = [
      { id: "self", name: "Zzz" },
      { id: "a", name: "Alice" },
    ];

    const result = orderPeopleForWholeTeam(members, "self");

    expect(result).toEqual(["self", "a"]);
  });

  it("AS-058: names with non-ASCII characters sort deterministically", () => {
    const members = [
      { id: "self", name: "Self Person" },
      { id: "z", name: "Zebra" },
      { id: "ae", name: "Ärla" },
    ];

    const result = orderPeopleForWholeTeam(members, "self");

    expect(result).toEqual(["self", "ae", "z"]);
  });
});

