// SEC-ACT1-05: only owners change/remove owners; the last-owner guard is
// the atomic change_workspace_member_role RPC. SEC-ACT1-06: project-lead
// rights need an active, non-client workspace membership.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/activity/audit", () => ({ writeAudit }));

const WS = "00000000-0000-4000-8000-0000000000aa";
const TARGET = "00000000-0000-4000-8000-0000000000bb";
const PROJECT = "00000000-0000-4000-8000-0000000000cc";
const OTHER_USER = "00000000-0000-4000-8000-0000000000dd";
const USER = "00000000-0000-4000-8000-000000000099";

let callerRole: "owner" | "admin" = "admin";
let targetRole = "owner";
let rpcResult: unknown[] = [{ changed: true, reason: null, old_role: "owner" }];
const rpc = vi.fn(async () => ({ data: rpcResult, error: null }));

let wsMembership: { role: string } | "missing" | null = null;
let leadRow: { id: string } | null = null;

vi.mock("@/lib/auth/require-membership", () => ({
  requireWorkspaceAdmin: vi.fn(async () => ({ ok: true, role: callerRole })),
  requireWorkspaceOwner: vi.fn(async () => ({ ok: callerRole === "owner", role: callerRole })),
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: callerRole })),
}));

function adminChain(table: string) {
  const c: Record<string, unknown> = {};
  const result = () => {
    if (table === "workspace_members") {
      if (wsMembership === "missing") return null;
      return wsMembership ?? { id: TARGET, status: "active", role: targetRole, user_id: OTHER_USER };
    }
    if (table === "project_members") return leadRow;
    if (table === "projects") return { id: PROJECT, workspace_id: WS };
    if (table === "workspaces") return { slug: "acme" };
    return null;
  };
  Object.assign(c, {
    select: () => c,
    eq: () => c,
    in: () => c,
    is: () => c,
    delete: () => c,
    maybeSingle: async () => ({ data: result(), error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 }),
  });
  return c;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: adminChain, rpc })),
}));

const sessionInsert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    rpc: vi.fn(async () => ({ error: null })),
    from: () => ({
      insert: (row: unknown) => {
        sessionInsert(row);
        return { select: () => ({ single: async () => ({ data: { id: "pm1", project_id: PROJECT, user_id: OTHER_USER, project_role: "member" }, error: null }) }) };
      },
    }),
  })),
}));

beforeEach(() => {
  callerRole = "admin";
  targetRole = "owner";
  rpcResult = [{ changed: true, reason: null, old_role: "owner" }];
  rpc.mockClear();
  writeAudit.mockClear();
  sessionInsert.mockClear();
  wsMembership = null;
  leadRow = null;
});

describe("changeMemberRole (SEC-ACT1-05)", () => {
  it("an admin cannot demote an owner", async () => {
    const { changeMemberRole } = await import("@/lib/actions/workspaces");
    const result = await changeMemberRole(WS, TARGET, "member");
    expect(result).toEqual({ ok: false, error: "Only an owner can change another owner's role." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an owner's demotion of a co-owner goes through the atomic RPC with the actor id", async () => {
    callerRole = "owner";
    const { changeMemberRole } = await import("@/lib/actions/workspaces");
    const result = await changeMemberRole(WS, TARGET, "member");
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("change_workspace_member_role", {
      p_membership_id: TARGET,
      p_workspace_id: WS,
      p_new_role: "member",
      p_actor_id: USER,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "member.role_changed" }),
    );
  });

  it("maps the RPC's sole_owner result (atomic last-owner guard)", async () => {
    callerRole = "owner";
    rpcResult = [{ changed: false, reason: "sole_owner", old_role: "owner" }];
    const { changeMemberRole } = await import("@/lib/actions/workspaces");
    const result = await changeMemberRole(WS, TARGET, "member");
    expect(result).toEqual({
      ok: false,
      error: "You cannot change the role of the sole owner of a workspace.",
    });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("maps owner_protected from the RPC (actor lost ownership concurrently)", async () => {
    callerRole = "owner";
    rpcResult = [{ changed: false, reason: "owner_protected", old_role: "owner" }];
    const { changeMemberRole } = await import("@/lib/actions/workspaces");
    expect((await changeMemberRole(WS, TARGET, "member")).ok).toBe(false);
  });
});

describe("removeMember (SEC-ACT1-05)", () => {
  it("an admin cannot remove an owner", async () => {
    const { removeMember } = await import("@/lib/actions/workspaces");
    const result = await removeMember(WS, TARGET);
    expect(result).toEqual({ ok: false, error: "Only an owner can remove another owner." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("project lead rights (SEC-ACT1-06)", () => {
  it.each([
    ["no longer a workspace member", "missing"],
    ["demoted to client", { role: "client" }],
    ["demoted to viewer", { role: "viewer" }],
  ])("a lead who is %s cannot add project members", async (_label, membership) => {
    // workspace_members lookup inside isProjectLeadOrWorkspaceAdmin
    wsMembership = membership as { role: string } | "missing";
    leadRow = { id: "lead-row" };
    const { addProjectMember } = await import("@/lib/actions/project-members");
    const result = await addProjectMember(PROJECT, OTHER_USER);
    expect(result.ok).toBe(false);
    expect(sessionInsert).not.toHaveBeenCalled();
  });

  it("an active member who is lead can add project members", async () => {
    wsMembership = { role: "member" };
    leadRow = { id: "lead-row" };
    const { addProjectMember } = await import("@/lib/actions/project-members");
    const result = await addProjectMember(PROJECT, OTHER_USER);
    expect(result.ok).toBe(true);
  });
});
