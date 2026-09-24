import { describe, expect, it } from "vitest";

import { canTeamWrite, type WorkspaceRole } from "@/lib/auth/permissions";

// The withAuthz default write gate: team roles only. Guests reach their
// write flows (comments, assignment) through their own gates.
describe("canTeamWrite", () => {
  const expected: Record<WorkspaceRole, boolean> = {
    owner: true,
    admin: true,
    member: true,
    viewer: false,
    guest: false,
    client: false,
  };
  for (const [role, allowed] of Object.entries(expected) as Array<[WorkspaceRole, boolean]>) {
    it(`${role}: ${allowed ? "allowed" : "denied"}`, () => {
      expect(canTeamWrite({ role })).toBe(allowed);
    });
  }
});
