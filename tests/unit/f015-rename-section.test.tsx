// @vitest-environment jsdom
//
// Mission 20260910-182104, F015 (AS-007, AS-034, AS-040): renameSection
// (lib/actions/architecture.ts). A section IS a subtask of its page task
// (standing decision 1), so renaming a section is a targeted update of
// that task's `title` column -- the same column the task list view reads
// for its title (AS-007).
//
// Mocks `@/lib/supabase/admin`'s createAdminClient the same minimal
// chainable-stub way tests/unit/f014-rename-page.test.tsx does.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

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
                  id: "66666666-6666-4666-8666-666666666666",
                  project_id: "33333333-3333-4333-8333-333333333333",
                  parent_task_id: "55555555-5555-4555-8555-555555555555",
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

describe("renameSection (F015)", () => {
  it("test_AS_007_renaming_updates_the_task_title_column", async () => {
    const { renameSection } = await import("@/lib/actions/architecture");
    const result = await renameSection(
      "66666666-6666-4666-8666-666666666666",
      "New Section Name",
    );

    expect(result.success).toBe(true);
    // AS-007: renaming a section outside the board changes the section
    // name shown on the board -- the board reads `tasks.title`, so
    // writing that column here is exactly what the board later renders.
    expect(updatedRow?.title).toBe("New Section Name");
  });

  it("test_AS_040_rejects_an_empty_name", async () => {
    const { renameSection } = await import("@/lib/actions/architecture");
    const result = await renameSection(
      "66666666-6666-4666-8666-666666666666",
      "   ",
    );

    expect(result.success).toBe(false);
    expect(updatedRow).toBeNull();
  });

  it("test_AS_040_rejects_a_name_that_is_only_whitespace_after_trim", async () => {
    const { renameSection } = await import("@/lib/actions/architecture");
    const result = await renameSection(
      "66666666-6666-4666-8666-666666666666",
      "\n\t ",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("SectionCard (F015)", () => {
  it("test_AS_034_renders_the_section_name_and_shows_an_input_on_click", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ refresh: () => {} }),
      useParams: () => ({ projectId: "test-project-id" }),
    }));
    vi.doMock("@/lib/actions/architecture", () => ({
      renameSection: async () => ({ success: true }),
    }));

    const { render, screen, fireEvent, cleanup } = await import(
      "@testing-library/react"
    );
    await import("@testing-library/jest-dom/vitest");
    const { SectionCard } = await import(
      "@/components/architecture/section-card"
    );

    const section = {
      id: "section-1",
      title: "Hero",
      position: 1,
      component: null,
    };

    render(<SectionCard section={section} />);

    expect(screen.getByText("Hero")).toBeTruthy();

    fireEvent.click(screen.getByText("Hero"));

    expect(screen.getByRole("textbox", { name: /section name/i })).toBeTruthy();

    cleanup();
  });
});
