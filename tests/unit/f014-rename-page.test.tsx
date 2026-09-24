// @vitest-environment jsdom
//
// Mission 20260910-182104, F014 (AS-006, AS-033, AS-039): renamePage
// (lib/actions/architecture.ts). A page IS a task (standing decision 1),
// so renaming a page is a targeted update of that task's `title` column
// -- the same column the task list view reads for its title (AS-006).
//
// Mocks `@/lib/supabase/admin`'s createAdminClient the same minimal
// chainable-stub way tests/unit/f010-create-page-action.test.ts does.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

let updatedRow: { id: string; title: unknown } | null = null;

function resetShared() {
  updatedRow = null;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "tasks") {
        throw new Error(`Unexpected table in test stub: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "55555555-5555-4555-8555-555555555555",
                  project_id: "33333333-3333-4333-8333-333333333333",
                  page_slug: "home",
                  projects: { workspace_id: "44444444-4444-4444-8444-444444444444" },
                },
                error: null,
              }),
            }),
          }),
        }),
        update: (row: { title: unknown }) => ({
          eq: async (_column: string, id: string) => {
            updatedRow = { id, title: row.title };
            return { error: null };
          },
        }),
      };
    },
  }),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "member" }),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => true,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeEach(() => {
  vi.resetModules();
  resetShared();
});

describe("renamePage (F014)", () => {
  it("test_AS_006_and_AS_033_renaming_updates_the_task_title_column", async () => {
    const { renamePage } = await import("@/lib/actions/architecture");
    const result = await renamePage(
      "55555555-5555-4555-8555-555555555555",
      "New Page Name",
    );

    expect(result.success).toBe(true);
    // AS-006: the task list view reads `tasks.title` -- renaming a page
    // (a task) writes that exact column, so the task list title updates
    // for free.
    expect(updatedRow?.title).toBe("New Page Name");
  });

  it("test_AS_039_rejects_an_empty_name", async () => {
    const { renamePage } = await import("@/lib/actions/architecture");
    const result = await renamePage(
      "55555555-5555-4555-8555-555555555555",
      "   ",
    );

    expect(result.success).toBe(false);
    expect(updatedRow).toBeNull();
  });

  it("test_AS_039_rejects_a_name_that_is_only_whitespace_after_trim", async () => {
    const { renamePage } = await import("@/lib/actions/architecture");
    const result = await renamePage(
      "55555555-5555-4555-8555-555555555555",
      "\n\t ",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("PageColumnHeader (F014)", () => {
  it("test_AS_033_renders_the_page_name_and_shows_an_input_on_click", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
    vi.doMock("@/lib/actions/architecture", () => ({
      renamePage: async () => ({ success: true }),
    }));

    const { render, screen, fireEvent, cleanup } = await import(
      "@testing-library/react"
    );
    await import("@testing-library/jest-dom/vitest");
    const { PageColumnHeader } = await import(
      "@/components/architecture/page-column-header"
    );

    const page = {
      id: "page-1",
      title: "Home",
      pageSlug: "home",
      pageKind: "static" as const,
      position: 1,
      description: null,
      sections: [],
    };

    render(<PageColumnHeader page={page} />);

    expect(screen.getByText("Home")).toBeTruthy();

    fireEvent.click(screen.getByText("Home"));

    expect(screen.getByRole("textbox", { name: /page name/i })).toBeTruthy();

    cleanup();
  });
});
