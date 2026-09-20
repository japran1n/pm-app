// F047 (AS-159, AS-160, AS-161): reorderComponents server action for the
// Architecture board's Components panel.
import { afterEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn(() => ({
  eq: vi.fn(async () => ({ error: null })),
}));

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
          update: updateMock,
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

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.clearAllMocks();
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
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("AS-161: a complete list updates every component's position to its index", async () => {
    const result = await reorderComponents(PROJECT_ID, [
      COMP_3,
      COMP_1,
      COMP_2,
    ]);

    expect(result.success).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(3);
    expect(updateMock).toHaveBeenCalledWith({ position: 0 });
    expect(updateMock).toHaveBeenCalledWith({ position: 1 });
    expect(updateMock).toHaveBeenCalledWith({ position: 2 });
  });
});
