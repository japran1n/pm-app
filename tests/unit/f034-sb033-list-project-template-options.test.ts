// F034 (FU-18, SB-033): the sidebar's lazy template fetch must only return
// template names to users who can create projects (same predicate as
// createProjectFromTemplate).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member" as string, ok: true, user: true }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ supabase: {}, user: state.user ? { id: "u1" } : null }),
}));
vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => (state.ok ? { ok: true, role: state.role } : { ok: false }),
  requireWorkspaceAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/queries/templates", () => ({
  getWorkspaceProjectTemplateOptions: async () => [
    { id: "t1", name: "Website Launch", isDefault: true },
    { id: "t2", name: "Retainer Onboarding", isDefault: false },
  ],
}));

import { listProjectTemplateOptions } from "@/lib/actions/templates";

beforeEach(() => {
  state.role = "member";
  state.ok = true;
  state.user = true;
});

describe("F034 SB-033 listProjectTemplateOptions permission", () => {
  for (const role of ["owner", "admin", "member"]) {
    it(`test_SB_033_${role}_gets_template_options`, async () => {
      state.role = role;
      expect((await listProjectTemplateOptions("ws-1")).map((t) => t.name)).toEqual([
        "Website Launch",
        "Retainer Onboarding",
      ]);
    });
  }
  for (const role of ["guest", "viewer", "client"]) {
    it(`test_SB_033_${role}_gets_no_template_options`, async () => {
      state.role = role;
      expect(await listProjectTemplateOptions("ws-1")).toEqual([]);
    });
  }
  it("test_SB_033_non_member_and_signed_out_get_nothing", async () => {
    state.ok = false;
    expect(await listProjectTemplateOptions("ws-1")).toEqual([]);
    state.ok = true;
    state.user = false;
    expect(await listProjectTemplateOptions("ws-1")).toEqual([]);
  });
});
