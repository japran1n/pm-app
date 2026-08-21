// F134 (AS-222: a guest cannot see the workspace members list or workspace
// settings). Exhaustive per-role matrix for the single predicate this
// feature adds to the shared permissions module (AS-230 convention: one
// predicate backs both the page-level guard and, if this control is ever
// rendered client-side, the UI gate — kept in its own file rather than
// tests/unit/permissions.test.ts to avoid colliding with concurrent work
// on that shared file).

import { describe, expect, it } from "vitest";

import { canViewMembersList } from "@/lib/auth/permissions";

describe("canViewMembersList", () => {
  it("AS-222: owner CAN view the members list", () => {
    expect(canViewMembersList({ role: "owner" })).toBe(true);
  });
  it("AS-222: admin CAN view the members list", () => {
    expect(canViewMembersList({ role: "admin" })).toBe(true);
  });
  it("AS-222: member CAN view the members list", () => {
    expect(canViewMembersList({ role: "member" })).toBe(true);
  });
  it("AS-222: viewer CAN view the members list (read-only elsewhere, but seeing who's in the workspace isn't itself a write)", () => {
    expect(canViewMembersList({ role: "viewer" })).toBe(true);
  });
  it("AS-222: guest CANNOT view the members list", () => {
    expect(canViewMembersList({ role: "guest" })).toBe(false);
  });
});
