// Mission 20260910-182104, F028 (AS-057): renameComponent
// (lib/actions/architecture.ts) and the read-side propagation
// getArchitectureBoard (lib/queries/architecture.ts) already provides via
// its section -> page_components join.
//
// AS-057: renaming a component changes the name displayed on every one of
// its instances. Because sections join to `page_components.name` via
// `tasks.component_id` -- nothing is copied per-instance -- the propagation
// is entirely a property of the read side re-running after the rename
// write commits. This file tests both halves: the write (renameComponent)
// and that the board-assembly join surfaces the updated name.
//
// Mocks follow the minimal chainable-stub convention
// tests/unit/f025-create-component.test.ts already established for this
// action file.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const COMPONENT_ID = "66666666-6666-4666-8666-666666666666";

let componentRow: {
  id: string;
  project_id: string;
  projects: { workspace_id: string };
} | null = null;

let updatedName: string | null = null;
let forceUpdateDuplicateError = false;

function resetShared() {
  componentRow = {
    id: COMPONENT_ID,
    project_id: PROJECT_ID,
    projects: { workspace_id: WORKSPACE_ID },
  };
  updatedName = null;
  forceUpdateDuplicateError = false;
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

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "admin" }),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => true,
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "page_components") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                if (!componentRow || componentRow.id !== id) {
                  return { data: null, error: null };
                }
                return { data: componentRow, error: null };
              },
            }),
          }),
          update: (values: { name?: string }) => ({
            eq: async (_col: string, id: string) => {
              if (forceUpdateDuplicateError) {
                return { error: { code: "23505", message: "duplicate" } };
              }
              if (componentRow && componentRow.id === id) {
                updatedName = values.name ?? null;
              }
              return { error: null };
            },
          }),
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    },
  }),
}));

describe("F028 renameComponent", () => {
  beforeEach(() => {
    resetShared();
  });

  it("renames a component with a valid name", async () => {
    const { renameComponent } = await import("@/lib/actions/architecture");

    const result = await renameComponent(COMPONENT_ID, "Footer");

    expect(result.success).toBe(true);
    expect(updatedName).toBe("Footer");
  });

  it("AS-066: rejects an empty name and writes nothing", async () => {
    const { renameComponent } = await import("@/lib/actions/architecture");

    const result = await renameComponent(COMPONENT_ID, "   ");

    expect(result.success).toBe(false);
    expect(updatedName).toBeNull();
  });

  it("AS-065: returns a friendly error on a duplicate name", async () => {
    const { renameComponent } = await import("@/lib/actions/architecture");

    forceUpdateDuplicateError = true;

    const result = await renameComponent(COMPONENT_ID, "Navbar");

    expect(result.success).toBe(false);
    expect(result.error).toBe("A component with this name already exists.");
  });

  it("returns an error when the component does not exist", async () => {
    const { renameComponent } = await import("@/lib/actions/architecture");

    const result = await renameComponent("does-not-exist", "Footer");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Component not found.");
  });
});

describe("F028 AS-057: every instance reflects a rename via the board join", () => {
  it("getArchitectureBoard returns the updated component name for every linked section after rename", async () => {
    const { buildBoardFromRows } = await import(
      "@/lib/queries/architecture"
    );

    const pageId = "77777777-7777-4777-8777-777777777777";
    const sectionAId = "88888888-8888-4888-8888-888888888888";
    const sectionBId = "99999999-9999-4999-8999-999999999999";

    const taskRows = [
      {
        id: pageId,
        title: "Home",
        page_slug: "home",
        page_kind: "static" as const,
        component_id: null,
        parent_task_id: null,
        position: 1,
        description_text: null,
      },
      {
        id: sectionAId,
        title: "Hero",
        page_slug: null,
        page_kind: null,
        component_id: COMPONENT_ID,
        parent_task_id: pageId,
        position: 1,
        description_text: null,
      },
      {
        id: sectionBId,
        title: "Hero 2",
        page_slug: null,
        page_kind: null,
        component_id: COMPONENT_ID,
        parent_task_id: pageId,
        position: 2,
        description_text: null,
      },
    ];

    const beforeRename = [
      { id: COMPONENT_ID, name: "Navbar", description: null, position: 1 },
    ];
    const afterRename = [
      { id: COMPONENT_ID, name: "Footer", description: null, position: 1 },
    ];

    const boardBefore = buildBoardFromRows(
      taskRows,
      beforeRename,
    );
    const boardAfter = buildBoardFromRows(
      taskRows,
      afterRename,
    );

    const sectionsBefore = boardBefore.pages[0]?.sections ?? [];
    const sectionsAfter = boardAfter.pages[0]?.sections ?? [];

    expect(sectionsBefore.every((s) => s.component?.name === "Navbar")).toBe(
      true,
    );
    expect(sectionsAfter.every((s) => s.component?.name === "Footer")).toBe(
      true,
    );
  });
});
