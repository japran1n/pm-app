// SEC-READ-01 / DB-ACCESS-03: getProjectById (admin read) re-applies the
// project read rule — active membership + isProjectVisibleToCaller — so
// the project layout 404s for guests / non-members of private (incl.
// archived) projects instead of rendering their name/description.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const WS = "00000000-0000-4000-8000-0000000000aa";
const PROJECT = "00000000-0000-4000-8000-0000000000cc";

let user: { id: string } | null = { id: "u1" };
let membership: { ok: true; role: string } | { ok: false } = { ok: true, role: "member" };
let visible = true;
const row = {
  id: PROJECT,
  workspace_id: WS,
  name: "Secret",
  description: "Confidential",
  start_date: null,
  end_date: null,
  created_at: "2026-01-01",
  deleted_at: "2026-02-01",
  key: null,
  billing_model: "hourly",
  visibility: "private",
};

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({ supabase: {}, user })),
  getRequestClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => membership),
}));
const isProjectVisibleToCaller = vi.fn(async () => visible);
vi.mock("@/lib/actions/project-visibility", () => ({
  isProjectVisibleToCaller: (...a: unknown[]) => isProjectVisibleToCaller(...(a as [])),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      from: () => c,
      select: () => c,
      eq: () => c,
      maybeSingle: async () => ({ data: row, error: null }),
    });
    return c;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { getProjectById } from "@/lib/queries/projects";

beforeEach(() => {
  user = { id: "u1" };
  membership = { ok: true, role: "member" };
  visible = true;
  isProjectVisibleToCaller.mockClear();
});

describe("getProjectById visibility (SEC-READ-01)", () => {
  it("returns null for a caller who cannot see the (archived, private) project", async () => {
    visible = false;
    expect(await getProjectById(WS, PROJECT)).toBeNull();
    expect(isProjectVisibleToCaller).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: PROJECT, visibility: "private" },
      "u1",
      "member",
    );
  });

  it("returns null for a non-member and for a signed-out caller", async () => {
    membership = { ok: false };
    expect(await getProjectById(WS, PROJECT)).toBeNull();
    user = null;
    expect(await getProjectById(WS, PROJECT)).toBeNull();
  });

  it("returns the project (archived included) when visible", async () => {
    const project = await getProjectById(WS, PROJECT);
    expect(project?.name).toBe("Secret");
    expect(project?.deletedAt).toBe("2026-02-01");
  });
});
