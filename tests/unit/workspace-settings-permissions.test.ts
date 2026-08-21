import { describe, expect, it } from "vitest";

import {
  canManageProject,
  canDeleteWorkspace,
} from "@/lib/auth/permissions";
import { renameWorkspaceSchema } from "@/lib/validation/workspaces";

describe("canManageProject (F136, AS-239: settings reachable for owner/admin)", () => {
  it("AS-239: an owner can manage workspace settings", () => {
    expect(canManageProject({ role: "owner" })).toBe(true);
  });

  it("AS-239: an admin can manage workspace settings", () => {
    expect(canManageProject({ role: "admin" })).toBe(true);
  });

  it("AS-239: a member cannot manage workspace settings", () => {
    expect(canManageProject({ role: "member" })).toBe(false);
  });

  it("AS-239: a viewer cannot manage workspace settings", () => {
    expect(canManageProject({ role: "viewer" })).toBe(false);
  });

  it("AS-239: a guest cannot manage workspace settings", () => {
    expect(canManageProject({ role: "guest" })).toBe(false);
  });
});

describe("canDeleteWorkspace (F136, AS-244: only an owner sees the delete-workspace control)", () => {
  it("AS-244: an owner may see/use the delete-workspace control", () => {
    expect(canDeleteWorkspace({ role: "owner" })).toBe(true);
  });

  it("AS-244: an admin must NOT see the delete-workspace control", () => {
    expect(canDeleteWorkspace({ role: "admin" })).toBe(false);
  });

  it("AS-244: a member must NOT see the delete-workspace control", () => {
    expect(canDeleteWorkspace({ role: "member" })).toBe(false);
  });

  it("AS-244: a viewer must NOT see the delete-workspace control", () => {
    expect(canDeleteWorkspace({ role: "viewer" })).toBe(false);
  });

  it("AS-244: a guest must NOT see the delete-workspace control", () => {
    expect(canDeleteWorkspace({ role: "guest" })).toBe(false);
  });
});

// A real v4 UUID (zod's .uuid() enforces the version nibble, unlike a
// plain "all-1s" placeholder string).
const VALID_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("renameWorkspaceSchema (F136, AS-240: rename input validation)", () => {
  it("accepts a well-formed workspaceId and name, trimming whitespace", () => {
    const result = renameWorkspaceSchema.safeParse({
      workspaceId: VALID_UUID,
      name: "  New Name  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("New Name");
    }
  });

  it("rejects an empty name", () => {
    const result = renameWorkspaceSchema.safeParse({
      workspaceId: VALID_UUID,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    const result = renameWorkspaceSchema.safeParse({
      workspaceId: VALID_UUID,
      name: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unreasonably long name", () => {
    const result = renameWorkspaceSchema.safeParse({
      workspaceId: VALID_UUID,
      name: "x".repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid workspaceId", () => {
    const result = renameWorkspaceSchema.safeParse({
      workspaceId: "not-a-uuid",
      name: "New Name",
    });
    expect(result.success).toBe(false);
  });
});
