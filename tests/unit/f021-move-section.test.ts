// Mission 20260910-182104, F021 (AS-043, AS-044, AS-045): a section can be
// dragged from one page to another (AS-043), becomes a subtask of the
// destination page's task via `parent_task_id` (AS-044), and keeps its
// component link across the move (AS-045). This file covers the
// server-action contract: moveSectionToPage exists, accepts the
// (sectionTaskId, newPageTaskId, position) shape the board's cross-column
// drag handler calls it with, and its update payload never touches
// `component_id`.
import { describe, expect, it, vi } from "vitest";

const updateMock = vi.fn((_payload: Record<string, unknown>) => ({
  eq: vi.fn(async () => ({ error: null })),
}));

const maybeSingleMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: maybeSingleMock,
              })),
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

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { moveSectionToPage } from "@/lib/actions/architecture";

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
    pages: () => ({ "page-old": "project-1", "page-new": "project-1" }),
  }),
);

describe("F021 moveSectionToPage", () => {
  it("AS-043/AS-044: accepts (sectionTaskId, newPageTaskId, position) and repoints parent_task_id + position", async () => {
    maybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: "section-1",
          project_id: "project-1",
          page_slug: null,
          parent_task_id: "page-old",
          projects: { workspace_id: "ws-1" },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: "page-new",
          page_slug: "new-page",
          projects: { workspace_id: "ws-1" },
        },
        error: null,
      });

    const result = await moveSectionToPage("section-1", "page-new", 2);

    expect(result.success).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({
      parent_task_id: "page-new",
      position: 2,
    });
  });

  it("AS-045: the update payload never includes component_id, so a moved section's component link is untouched", async () => {
    maybeSingleMock
      .mockResolvedValueOnce({
        data: {
          id: "section-2",
          project_id: "project-1",
          page_slug: null,
          parent_task_id: "page-old",
          projects: { workspace_id: "ws-1" },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: "page-new",
          page_slug: "new-page",
          projects: { workspace_id: "ws-1" },
        },
        error: null,
      });

    await moveSectionToPage("section-2", "page-new", 1);

    const lastCallPayload = updateMock.mock.calls.at(-1)?.[0];
    expect(lastCallPayload).not.toHaveProperty("component_id");
  });

  it("rejects a malformed payload before touching the database", async () => {
    updateMock.mockClear();
    const result = await moveSectionToPage("", "page-new", 1);
    expect(result.success).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
