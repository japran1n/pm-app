// F047 (AS-159, AS-160, AS-161): reorderComponents server action for the
// Architecture board's Components panel.
import { afterEach, describe, expect, it, vi } from "vitest";

const upsertCalls: { rows: { id: string; position: number }[]; options: unknown }[] = [];

const upsertMock = vi.fn(
  async (rows: { id: string; position: number }[], options: unknown) => {
    upsertCalls.push({ rows, options });
    return { error: null };
  },
);

const COMP_1 = "00000000-0000-4000-8000-000000000101";
const COMP_2 = "00000000-0000-4000-8000-000000000102";
const COMP_3 = "00000000-0000-4000-8000-000000000103";

let existingComponentIds = [COMP_1, COMP_2, COMP_3];

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "project-1",
                    workspace_id: "ws-1",
                    workspaces: { slug: "acme" },
                  },
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      if (table === "page_components") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: existingComponentIds.map((id) => ({ id })),
              error: null,
            })),
          })),
          upsert: upsertMock,
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  })),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: "admin" })),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: vi.fn(() => true),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions/portal-revalidate", () => ({
  revalidatePortalProject: vi.fn(),
  extractWorkspaceSlug: (workspace: unknown) => {
    if (!workspace) return null;
    if (Array.isArray(workspace)) return (workspace[0] as { slug?: string })?.slug ?? null;
    return (workspace as { slug?: string }).slug ?? null;
  },
}));

import { reorderComponents } from "@/lib/actions/architecture";

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.clearAllMocks();
  upsertCalls.length = 0;
  existingComponentIds = [COMP_1, COMP_2, COMP_3];
});

describe("F047 reorderComponents", () => {
  it("AS-159: reorderComponents is exported from the barrel", () => {
    expect(typeof reorderComponents).toBe("function");
  });

  it("AS-160: an incomplete component list is rejected", async () => {
    // existingComponentIds has 3 components; caller only submits 2.
    const result = await reorderComponents(PROJECT_ID, [COMP_1, COMP_2]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Component list is incomplete.");
    }
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("AS-160 duplicate ids are rejected", async () => {
    // Only 2 distinct ids submitted for a project with 3 components -- the
    // schema's uniqueness refinement should reject this before it ever
    // reaches the DB completeness check.
    const result = await reorderComponents(PROJECT_ID, [COMP_1, COMP_1, COMP_2]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("AS-160 foreign id rejected", async () => {
    const FOREIGN_ID = "00000000-0000-4000-8000-000000000999";
    // Same length as existingComponentIds (3), but one id doesn't belong to
    // any page_components row for this project.
    const result = await reorderComponents(PROJECT_ID, [
      COMP_1,
      COMP_2,
      FOREIGN_ID,
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("AS-161: a complete list writes every id's position matching its index in the submitted order, not DB order", async () => {
    // Submitted order deliberately differs from DB/existingComponentIds
    // order (COMP_1, COMP_2, COMP_3) -- if the implementation wrote
    // positions in DB row order instead of the submitted order, this test
    // would fail.
    const result = await reorderComponents(PROJECT_ID, [
      COMP_3,
      COMP_1,
      COMP_2,
    ]);

    expect(result.success).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertCalls).toHaveLength(1);

    const [{ rows, options }] = upsertCalls;
    expect(options).toEqual({ onConflict: "id" });

    // Exact (id, position) pairing: index in the *submitted* array, not
    // the DB's row order.
    const positionById = new Map(rows.map((row) => [row.id, row.position]));
    expect(positionById.get(COMP_3)).toBe(0);
    expect(positionById.get(COMP_1)).toBe(1);
    expect(positionById.get(COMP_2)).toBe(2);
    expect(rows).toHaveLength(3);
  });
});
