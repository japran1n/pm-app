// @vitest-environment jsdom
//
// Mission 20260910-182104, F022 (AS-046, AS-047): a page column can be
// reordered by dragging (AS-046) and keeps its new position after reload
// (AS-047). This file covers the server-action contract (reorderPages
// exists with the same batched-position-update shape reorderSections
// already uses for sections) and that the board renders columns in the
// order the `pages` prop supplies them in.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const updateMock = vi.fn(() => ({
  eq: vi.fn(async () => ({ error: null })),
}));

const inMock = vi.fn(async () => ({
  data: [
    { id: "page-1", project_id: "project-1", page_slug: "home", parent_task_id: null },
    { id: "page-2", project_id: "project-1", page_slug: "pricing", parent_task_id: null },
  ],
  error: null,
}));

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
            in: vi.fn(() => ({
              is: vi.fn(inMock),
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

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
  useParams: vi.fn(() => ({ projectId: "project-1" })),
}));

import { reorderPages } from "@/lib/actions/architecture";
import { ArchitectureBoard } from "@/components/architecture/board";
import type { BoardPage } from "@/lib/queries/architecture";

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makePage(overrides: Partial<BoardPage>): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 0,
    sections: [],
    ...overrides,
  };
}

describe("F022 reorder page columns", () => {
  it("AS-046: reorderPages exists and batch-updates task positions", async () => {
    expect(typeof reorderPages).toBe("function");

    const result = await reorderPages([
      { id: "page-1", position: 1 },
      { id: "page-2", position: 2 },
    ]);

    expect(result.success).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith({ position: 1 });
    expect(updateMock).toHaveBeenCalledWith({ position: 2 });
  });

  it("AS-046: rejects an empty reorder payload", async () => {
    const result = await reorderPages([]);
    expect(result.success).toBe(false);
  });

  it("AS-047: the board renders columns in the order the pages prop supplies", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Home", pageSlug: "home" }),
      makePage({ id: "page-2", title: "Pricing", pageSlug: "pricing" }),
      makePage({ id: "page-3", title: "About", pageSlug: "about" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    const headings = screen.getAllByText(/Home|Pricing|About/);
    const order = headings.map((node) => node.textContent);
    expect(order).toEqual(["Home", "Pricing", "About"]);
  });
});
