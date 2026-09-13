// Mission 20260910-182104, F025 (AS-051, AS-052): createComponentFromSection
// and createComponent (lib/actions/architecture.ts).
//
// AS-051: a section can be turned into a component.
// AS-052: turning a section into a component creates a component named
// after that section.
//
// Mocks follow the minimal chainable-stub convention
// tests/unit/f015-rename-section.test.tsx already established for this
// action file.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "44444444-4444-4444-8444-444444444444";

let sectionRow: {
  id: string;
  project_id: string;
  title: string;
  page_slug: string | null;
  parent_task_id: string | null;
  section_kind: null,
  component_id: string | null;
  projects: { workspace_id: string };
} | null = null;

let insertedComponents: { id: string; project_id: string; name: string; position: number }[] =
  [];
let updatedTaskComponentId: string | null = null;
let existingComponentCount = 0;
let forceInsertDuplicateError = false;

function resetShared() {
  sectionRow = {
    id: SECTION_ID,
    project_id: PROJECT_ID,
    title: "Hero",
    page_slug: null,
    parent_task_id: "55555555-5555-4555-8555-555555555555",
    section_kind: null,
    component_id: null,
    projects: { workspace_id: WORKSPACE_ID },
  };
  insertedComponents = [];
  updatedTaskComponentId = null;
  existingComponentCount = 0;
  forceInsertDuplicateError = false;
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
      if (table === "tasks") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              is: () => ({
                maybeSingle: async () => {
                  if (!sectionRow || sectionRow.id !== id) {
                    return { data: null, error: null };
                  }
                  return { data: sectionRow, error: null };
                },
              }),
            }),
          }),
          update: (values: { component_id?: string }) => ({
            eq: async (_col: string, id: string) => {
              if (sectionRow && sectionRow.id === id) {
                updatedTaskComponentId = values.component_id ?? null;
              }
              return { error: null };
            },
          }),
        };
      }

      if (table === "page_components") {
        return {
          select: () => ({
            eq: async () => ({ count: existingComponentCount, error: null }),
          }),
          insert: (row: { project_id: string; name: string; position: number }) => ({
            select: () => ({
              single: async () => {
                if (forceInsertDuplicateError) {
                  return { data: null, error: { code: "23505", message: "duplicate" } };
                }
                const inserted = { id: `component-${insertedComponents.length + 1}`, ...row };
                insertedComponents.push(inserted);
                return { data: { id: inserted.id }, error: null };
              },
            }),
          }),
        };
      }

      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
                error: null,
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    },
  }),
}));

describe("F025 create component from section", () => {
  beforeEach(() => {
    resetShared();
  });

  it("AS-051/AS-052: creates a component named after the section for an unlinked section", async () => {
    const { createComponentFromSection } = await import("@/lib/actions/architecture");

    const result = await createComponentFromSection(SECTION_ID, PROJECT_ID);

    expect(result.success).toBe(true);
    expect(insertedComponents).toHaveLength(1);
    expect(insertedComponents[0].name).toBe("Hero");
    expect(insertedComponents[0].project_id).toBe(PROJECT_ID);
    expect(updatedTaskComponentId).toBe(insertedComponents[0].id);
  });

  it("returns an error and creates nothing when the section is already linked to a component", async () => {
    const { createComponentFromSection } = await import("@/lib/actions/architecture");

    sectionRow!.component_id = "existing-component";

    const result = await createComponentFromSection(SECTION_ID, PROJECT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Section already linked to a component");
    expect(insertedComponents).toHaveLength(0);
  });
});

describe("F025 createComponent", () => {
  beforeEach(() => {
    resetShared();
  });

  it("creates a component with the given name", async () => {
    const { createComponent } = await import("@/lib/actions/architecture");

    const result = await createComponent(PROJECT_ID, "Navbar");

    expect(result.success).toBe(true);
    expect(insertedComponents).toHaveLength(1);
    expect(insertedComponents[0].name).toBe("Navbar");
  });

  it("AS-066: rejects an empty name", async () => {
    const { createComponent } = await import("@/lib/actions/architecture");

    const result = await createComponent(PROJECT_ID, "   ");

    expect(result.success).toBe(false);
    expect(insertedComponents).toHaveLength(0);
  });

  it("AS-065: returns an error on a duplicate name", async () => {
    const { createComponent } = await import("@/lib/actions/architecture");

    forceInsertDuplicateError = true;

    const result = await createComponent(PROJECT_ID, "Navbar");

    expect(result.success).toBe(false);
    expect(result.error).toBe("A component with this name already exists.");
  });
});
