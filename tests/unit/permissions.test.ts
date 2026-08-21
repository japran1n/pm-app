// F127 (AS-230: one permission helper backs both UI gating and the
// server-side re-check).
//
// Exhaustive matrix: every role x every predicate, each asserted as its
// own explicit test (per the F127 clarification's "boundary cases"
// instruction — no `for (const role of roles)` loop, so a future reader
// can see exactly what's expected for exactly which role at a glance).

import { describe, expect, it } from "vitest";

import {
  canDeleteTask,
  canEditTask,
  canManageColumns,
  canManageMembers,
  canManageProject,
  canPurge,
  canViewAudit,
  canWrite,
  isResourceOwner,
  type PermissionContext,
} from "@/lib/auth/permissions";

const CALLER = "user-caller";
const OTHER = "user-other";

// --- canManageProject -------------------------------------------------

describe("canManageProject", () => {
  it("AS-230: owner can manage project/workspace settings", () => {
    expect(canManageProject({ role: "owner" })).toBe(true);
  });
  it("AS-230: admin can manage project/workspace settings", () => {
    expect(canManageProject({ role: "admin" })).toBe(true);
  });
  it("AS-230: member cannot manage project/workspace settings", () => {
    expect(canManageProject({ role: "member" })).toBe(false);
  });
  it("AS-230: viewer cannot manage project/workspace settings", () => {
    expect(canManageProject({ role: "viewer" })).toBe(false);
  });
  it("AS-230: guest cannot manage project/workspace settings", () => {
    expect(canManageProject({ role: "guest" })).toBe(false);
  });
});

// --- canManageMembers ---------------------------------------------------

describe("canManageMembers", () => {
  it("AS-230: owner can manage members", () => {
    expect(canManageMembers({ role: "owner" })).toBe(true);
  });
  it("AS-230: admin can manage members", () => {
    expect(canManageMembers({ role: "admin" })).toBe(true);
  });
  it("AS-230: member cannot manage members", () => {
    expect(canManageMembers({ role: "member" })).toBe(false);
  });
  it("AS-230: viewer cannot manage members", () => {
    expect(canManageMembers({ role: "viewer" })).toBe(false);
  });
  it("AS-230: guest cannot manage members", () => {
    expect(canManageMembers({ role: "guest" })).toBe(false);
  });
});

// --- canManageColumns -----------------------------------------------------

describe("canManageColumns", () => {
  it("AS-230: owner can manage columns", () => {
    expect(canManageColumns({ role: "owner" })).toBe(true);
  });
  it("AS-230: admin can manage columns", () => {
    expect(canManageColumns({ role: "admin" })).toBe(true);
  });
  it("AS-230: plain member without a project lead role cannot manage columns", () => {
    expect(canManageColumns({ role: "member" })).toBe(false);
  });
  it("AS-230: member who is the project lead can manage columns on that project", () => {
    expect(canManageColumns({ role: "member", projectRole: "lead" })).toBe(true);
  });
  it("AS-230: member who is a plain project member (not lead) cannot manage columns", () => {
    expect(canManageColumns({ role: "member", projectRole: "member" })).toBe(false);
  });
  it("AS-230: viewer cannot manage columns even as project lead", () => {
    expect(canManageColumns({ role: "viewer", projectRole: "lead" })).toBe(false);
  });
  it("AS-230: guest cannot manage columns even as project lead", () => {
    expect(canManageColumns({ role: "guest", projectRole: "lead" })).toBe(false);
  });
});

// --- canViewAudit --------------------------------------------------------

describe("canViewAudit", () => {
  it("AS-230: owner can view the audit log", () => {
    expect(canViewAudit({ role: "owner" })).toBe(true);
  });
  it("AS-230: admin can view the audit log", () => {
    expect(canViewAudit({ role: "admin" })).toBe(true);
  });
  it("AS-230: member cannot view the audit log", () => {
    expect(canViewAudit({ role: "member" })).toBe(false);
  });
  it("AS-230: viewer cannot view the audit log", () => {
    expect(canViewAudit({ role: "viewer" })).toBe(false);
  });
  it("AS-230: guest cannot view the audit log", () => {
    expect(canViewAudit({ role: "guest" })).toBe(false);
  });
});

// --- canPurge --------------------------------------------------------------

describe("canPurge", () => {
  it("AS-230: owner can purge", () => {
    expect(canPurge({ role: "owner" })).toBe(true);
  });
  it("AS-230: admin cannot purge (owner-only, irreversible action)", () => {
    expect(canPurge({ role: "admin" })).toBe(false);
  });
  it("AS-230: member cannot purge", () => {
    expect(canPurge({ role: "member" })).toBe(false);
  });
  it("AS-230: viewer cannot purge", () => {
    expect(canPurge({ role: "viewer" })).toBe(false);
  });
  it("AS-230: guest cannot purge", () => {
    expect(canPurge({ role: "guest" })).toBe(false);
  });
});

// --- canEditTask -----------------------------------------------------------

describe("canEditTask", () => {
  it("AS-230: owner can edit any task", () => {
    expect(canEditTask({ role: "owner" })).toBe(true);
  });
  it("AS-230: admin can edit any task", () => {
    expect(canEditTask({ role: "admin" })).toBe(true);
  });
  it("AS-230: member can edit a task", () => {
    expect(canEditTask({ role: "member" })).toBe(true);
  });
  it("AS-230: viewer cannot edit a task even if they own it (read-only role)", () => {
    expect(
      canEditTask({ role: "viewer", resourceOwnerId: CALLER, callerId: CALLER }),
    ).toBe(false);
  });
  it("AS-230: guest cannot edit a task even if they own it (read-only role)", () => {
    expect(
      canEditTask({ role: "guest", resourceOwnerId: CALLER, callerId: CALLER }),
    ).toBe(false);
  });
});

// --- canDeleteTask ---------------------------------------------------------

describe("canDeleteTask", () => {
  it("AS-230: owner can delete any task, including one they don't own", () => {
    expect(
      canDeleteTask({ role: "owner", resourceOwnerId: OTHER, callerId: CALLER }),
    ).toBe(true);
  });
  it("AS-230: admin can delete any task, including one they don't own", () => {
    expect(
      canDeleteTask({ role: "admin", resourceOwnerId: OTHER, callerId: CALLER }),
    ).toBe(true);
  });
  it("AS-230: member can delete a task they created", () => {
    expect(
      canDeleteTask({ role: "member", resourceOwnerId: CALLER, callerId: CALLER }),
    ).toBe(true);
  });
  it("AS-230: member cannot delete a task created by someone else", () => {
    expect(
      canDeleteTask({ role: "member", resourceOwnerId: OTHER, callerId: CALLER }),
    ).toBe(false);
  });
  it("AS-230: member who is the project lead can delete a task they don't own on that project", () => {
    expect(
      canDeleteTask({
        role: "member",
        projectRole: "lead",
        resourceOwnerId: OTHER,
        callerId: CALLER,
      }),
    ).toBe(true);
  });
  it("AS-230: viewer cannot delete a task they created (read-only role overrides ownership)", () => {
    expect(
      canDeleteTask({ role: "viewer", resourceOwnerId: CALLER, callerId: CALLER }),
    ).toBe(false);
  });
  it("AS-230: guest cannot delete a task they created (read-only role overrides ownership)", () => {
    expect(
      canDeleteTask({ role: "guest", resourceOwnerId: CALLER, callerId: CALLER }),
    ).toBe(false);
  });
  it("AS-230: member with no resourceOwnerId/callerId supplied is treated as not the owner", () => {
    expect(canDeleteTask({ role: "member" })).toBe(false);
  });
});

// --- canWrite (F128: AS-216, AS-217) ---------------------------------------

describe("canWrite", () => {
  it("test_AS_216_owner_can_write", () => {
    expect(canWrite({ role: "owner" })).toBe(true);
  });
  it("test_AS_216_admin_can_write", () => {
    expect(canWrite({ role: "admin" })).toBe(true);
  });
  it("test_AS_216_member_can_write", () => {
    expect(canWrite({ role: "member" })).toBe(true);
  });
  it("test_AS_216_viewer_cannot_write", () => {
    expect(canWrite({ role: "viewer" })).toBe(false);
  });
  it("AS-223: guest is NOT excluded by this generic gate — guest write access is project-scoped (F134) and governed by its own rules, not this predicate", () => {
    expect(canWrite({ role: "guest" })).toBe(true);
  });
  it("test_AS_217_viewer_cannot_write_even_as_resource_owner", () => {
    // A viewer's own-resource ownership never grants write access — the
    // read-only role always wins, matching canEditTask/canDeleteTask's
    // "role overrides ownership" convention for viewer/guest.
    expect(
      canWrite({ role: "viewer", resourceOwnerId: CALLER, callerId: CALLER }),
    ).toBe(false);
  });
});

// --- isResourceOwner ------------------------------------------------------

describe("isResourceOwner", () => {
  it("AS-230: true when callerId matches resourceOwnerId", () => {
    expect(isResourceOwner({ role: "member", callerId: CALLER, resourceOwnerId: CALLER })).toBe(
      true,
    );
  });
  it("AS-230: false when callerId differs from resourceOwnerId", () => {
    expect(isResourceOwner({ role: "member", callerId: CALLER, resourceOwnerId: OTHER })).toBe(
      false,
    );
  });
  it("AS-230: false when resourceOwnerId is null (invalid/unknown input, no throw)", () => {
    const ctx: PermissionContext = { role: "member", callerId: CALLER, resourceOwnerId: null };
    expect(isResourceOwner(ctx)).toBe(false);
  });
  it("AS-230: false when callerId is missing (invalid/unknown input, no throw)", () => {
    expect(isResourceOwner({ role: "member", resourceOwnerId: OTHER })).toBe(false);
  });
});
