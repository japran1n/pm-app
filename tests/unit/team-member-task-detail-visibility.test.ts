// Unit coverage for canViewTeamMemberTaskDetail (lib/auth/permissions.ts)
// — gates the team member profile page's "Tasks" section
// (app/(workspace)/w/[workspaceSlug]/team/[userId]/page.tsx). Mirrors
// tests/unit/time-entry-notes-visibility.test.ts's shape exactly, since
// the predicate itself mirrors canViewIndividualTimeEntryNotes.
import { describe, expect, it } from "vitest";
import { canViewTeamMemberTaskDetail } from "@/lib/auth/permissions";

describe("canViewTeamMemberTaskDetail", () => {
  it("always allows a caller to see their own assigned tasks, regardless of role", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "member",
        callerId: "u1",
        resourceOwnerId: "u1",
      }),
    ).toBe(true);
  });

  it("allows an owner to see another member's assigned tasks", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "owner",
        callerId: "u1",
        resourceOwnerId: "u2",
      }),
    ).toBe(true);
  });

  it("allows an admin to see another member's assigned tasks", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "admin",
        callerId: "u1",
        resourceOwnerId: "u2",
      }),
    ).toBe(true);
  });

  it("allows a project lead of a relevant project to see another member's assigned tasks", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "member",
        callerId: "u1",
        resourceOwnerId: "u2",
        isProjectLeadOnResource: true,
      }),
    ).toBe(true);
  });

  it("denies a plain member viewing another member's assigned tasks with no project-lead relationship", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "member",
        callerId: "u1",
        resourceOwnerId: "u2",
        isProjectLeadOnResource: false,
      }),
    ).toBe(false);
  });

  it("denies a client role from viewing another member's assigned tasks even if flagged as project lead", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "client",
        callerId: "u1",
        resourceOwnerId: "u2",
        isProjectLeadOnResource: true,
      }),
    ).toBe(false);
  });

  it("denies a viewer role viewing another member's assigned tasks", () => {
    expect(
      canViewTeamMemberTaskDetail({
        role: "viewer",
        callerId: "u1",
        resourceOwnerId: "u2",
      }),
    ).toBe(false);
  });
});
