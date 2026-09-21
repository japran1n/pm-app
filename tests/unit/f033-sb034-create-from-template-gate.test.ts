// F033 (FU-17, SB-034, SB-006): createProjectFromTemplate must use the same
// canCreateProject predicate as the sidebar "+ New" Project entry. A guest
// (canWrite === true) must not be able to create a project by calling the
// server action directly. Drives the REAL action per role against a DB mock
// that records every project-creating write.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "member" as string,
  ok: true,
  projectInserts: 0,
  tableInserts: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ supabase: {}, user: { id: "u1" } }),
}));
vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () =>
    state.ok ? { ok: true, role: state.role } : { ok: false },
  requireWorkspaceAdmin: vi.fn(),
}));
vi.mock("@/lib/activity/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const WS = "11111111-1111-4111-8111-111111111111";
const TPL = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // The RPC is the project INSERT for this action.
    rpc: async (fn: string) => {
      if (fn === "create_project_from_template") state.projectInserts++;
      return { data: null, error: { message: "stop-after-insert" } };
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({
        data: {
          id: TPL,
          workspace_id: WS,
          kind: "project",
          payload: {
            tasks: [],
            phases: [],
            deliverables: [],
          },
        },
        error: null,
      });
      chain.insert = () => {
        state.tableInserts.push(table);
        if (table === "projects") state.projectInserts++;
        return Promise.resolve({ error: null });
      };
      return chain;
    },
  }),
}));

import { createProjectFromTemplate } from "@/lib/actions/templates";
import { canCreateProject, type WorkspaceRole } from "@/lib/auth/permissions";

const roles: WorkspaceRole[] = ["owner", "admin", "member", "viewer", "guest", "client"];
const allowed: Record<WorkspaceRole, boolean> = {
  owner: true, admin: true, member: true, viewer: false, guest: false, client: false,
};

beforeEach(() => {
  state.role = "member";
  state.ok = true;
  state.projectInserts = 0;
  state.tableInserts = [];
});

describe("F033 SB-034 createProjectFromTemplate role matrix", () => {
  for (const r of roles) {
    it(`test_SB_034_template_action_${r}_${allowed[r] ? "inserts_one_project" : "inserts_zero_rows"}`, async () => {
      state.role = r;
      const res = await createProjectFromTemplate(TPL, WS, "Apollo");
      if (allowed[r]) {
        expect(state.projectInserts).toBe(1);
      } else {
        expect(res.ok).toBe(false);
        expect(state.projectInserts).toBe(0);
        expect(state.tableInserts).toEqual([]);
      }
    });
  }

  it("test_SB_034_template_action_guest_is_rejected_with_a_non_viewer_message", async () => {
    state.role = "guest";
    const res = await createProjectFromTemplate(TPL, WS, "Apollo");
    expect(res).toEqual({
      ok: false,
      error: "You don't have permission to create projects in this workspace.",
    });
  });

  it("test_SB_034_template_action_no_membership_inserts_nothing", async () => {
    state.ok = false;
    const res = await createProjectFromTemplate(TPL, WS, "Apollo");
    expect(res.ok).toBe(false);
    expect(state.projectInserts).toBe(0);
  });

  it("test_SB_034_predicate_agrees_with_server_outcome_for_every_role", async () => {
    for (const r of roles) {
      state.role = r;
      state.projectInserts = 0;
      await createProjectFromTemplate(TPL, WS, "Apollo");
      expect(state.projectInserts === 1).toBe(canCreateProject({ role: r }));
    }
  });
});
