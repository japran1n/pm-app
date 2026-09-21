// F031 (SB-034): the sidebar "+ New" gate and the createProject server action
// share ONE predicate (canCreateProject). Server-side role matrix here; the
// sidebar side is in f009-sb033-sb034-new-menu.test.ts (real Chromium).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member" as string, ok: true, inserted: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ supabase: {}, user: { id: "u1" } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      state.inserted++;
      throw new Error("stop-after-gate");
    },
  }),
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

import { createProject } from "@/lib/actions/projects";
import { canCreateProject, canWrite, type WorkspaceRole } from "@/lib/auth/permissions";

const WS = "11111111-1111-4111-8111-111111111111";
const roles: WorkspaceRole[] = ["owner", "admin", "member", "viewer", "guest", "client"];
const allowed: Record<WorkspaceRole, boolean> = {
  owner: true, admin: true, member: true, viewer: false, guest: false, client: false,
};

beforeEach(() => {
  state.role = "member";
  state.ok = true;
  state.inserted = 0;
});

describe("F031 SB-034 canCreateProject role matrix", () => {
  for (const r of roles) {
    it(`test_SB_034_predicate_${r}_${allowed[r] ? "allowed" : "denied"}`, () => {
      expect(canCreateProject({ role: r })).toBe(allowed[r]);
    });
  }
  it("test_SB_034_guest_is_denied_even_though_canWrite_allows_it", () => {
    expect(canWrite({ role: "guest" })).toBe(true);
    expect(canCreateProject({ role: "guest" })).toBe(false);
  });
});

describe("F031 SB-034 createProject server action uses the same predicate", () => {
  for (const r of roles) {
    it(`test_SB_034_action_${r}_${allowed[r] ? "passes_gate" : "rejected"}`, async () => {
      state.role = r;
      if (allowed[r]) {
        // Past the gate the mock admin client throws; reaching it proves the gate passed.
        await createProject(WS, "Apollo").catch(() => undefined);
        expect(state.inserted).toBeGreaterThan(0);
      } else {
        const res = await createProject(WS, "Apollo");
        expect(res.ok).toBe(false);
        expect(state.inserted).toBe(0);
      }
    });
  }
  it("test_SB_034_action_guest_message_and_no_membership_rejected", async () => {
    state.role = "guest";
    expect(await createProject(WS, "Apollo")).toEqual({ ok: false, error: "Guests cannot create projects." });
    state.ok = false;
    expect((await createProject(WS, "Apollo")).ok).toBe(false);
    expect(state.inserted).toBe(0);
  });
});
