// Unit coverage for canViewIndividualTimeEntryNotes
// (lib/auth/permissions.ts) — the per-person time drill-down page's gate
// on individual time-entry rows with notes
// (app/(workspace)/w/[workspaceSlug]/time/[userId]/page.tsx).
import { describe, expect, it } from "vitest";
import { canViewIndividualTimeEntryNotes } from "@/lib/auth/permissions";

describe("canViewIndividualTimeEntryNotes", () => {
  it("always allows a caller to see their own entries' notes, regardless of role", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "member",
        callerId: "u1",
        resourceOwnerId: "u1",
      }),
    ).toBe(true);
  });

  it("allows an owner to see another member's notes", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "owner",
        callerId: "u1",
        resourceOwnerId: "u2",
      }),
    ).toBe(true);
  });

  it("allows an admin to see another member's notes", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "admin",
        callerId: "u1",
        resourceOwnerId: "u2",
      }),
    ).toBe(true);
  });

  it("allows a project lead of a relevant project to see another member's notes", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "member",
        callerId: "u1",
        resourceOwnerId: "u2",
        isProjectLeadOnResource: true,
      }),
    ).toBe(true);
  });

  it("denies a plain member viewing another member's notes with no project-lead relationship", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "member",
        callerId: "u1",
        resourceOwnerId: "u2",
        isProjectLeadOnResource: false,
      }),
    ).toBe(false);
  });

  it("denies a client role from viewing another member's notes even if flagged as project lead", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "client",
        callerId: "u1",
        resourceOwnerId: "u2",
        isProjectLeadOnResource: true,
      }),
    ).toBe(false);
  });

  it("denies a viewer role viewing another member's notes", () => {
    expect(
      canViewIndividualTimeEntryNotes({
        role: "viewer",
        callerId: "u1",
        resourceOwnerId: "u2",
      }),
    ).toBe(false);
  });
});
