// Mission 20260910-182104, F031 (AS-062, AS-064): one-component and
// cross-project guards on linkComponentToSection (lib/actions/architecture.ts).
//
// AS-062: a section can be linked to at most one component -- enforced by
// the schema itself (`tasks.component_id` is a single column), so linking
// a second component simply replaces the first.
// AS-064: a component from one project cannot be linked to a section in
// another project.
//
// Mocks follow the minimal chainable-stub convention
// tests/unit/f025-create-component-from-section.test.tsx already
// established for this action file.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const SECTION_ID = "44444444-4444-4444-8444-444444444444";
const COMPONENT_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_COMPONENT_ID = "88888888-8888-4888-8888-888888888888";

let sectionRow: {
  id: string;
  project_id: string;
  page_slug: string | null;
  parent_task_id: string | null;
  section_kind: null,
  component_id: string | null;
  projects: { workspace_id: string };
} | null = null;

let componentRow: { id: string; project_id: string } | null = null;
let updatedTaskComponentId: string | null = null;

function resetShared() {
  sectionRow = {
    id: SECTION_ID,
    project_id: PROJECT_ID,
    page_slug: null,
    parent_task_id: "55555555-5555-4555-8555-555555555555",
    section_kind: null,
    component_id: "existing-component-id",
    projects: { workspace_id: WORKSPACE_ID },
  };
  componentRow = { id: COMPONENT_ID, project_id: PROJECT_ID };
  updatedTaskComponentId = null;
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
              maybeSingle: async () => {
                if (!sectionRow || sectionRow.id !== id) {
                  return { data: null, error: null };
                }
                return { data: sectionRow, error: null };
              },
            }),
          }),
          update: (values: { component_id?: string }) => ({
            eq: async (_col: string, id: string) => {
              if (sectionRow && sectionRow.id === id) {
                updatedTaskComponentId = values.component_id ?? null;
                sectionRow.component_id = values.component_id ?? null;
              }
              return { error: null };
            },
          }),
        };
      }

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

describe("F031 linkComponentToSection guards", () => {
  beforeEach(() => {
    resetShared();
  });

  it("AS-064: rejects linking a component from a different project", async () => {
    const { linkComponentToSection } = await import("@/lib/actions/architecture");

    componentRow = { id: OTHER_COMPONENT_ID, project_id: OTHER_PROJECT_ID };

    const result = await linkComponentToSection(SECTION_ID, OTHER_COMPONENT_ID);

    expect(result.success).toBe(false);
    expect(updatedTaskComponentId).toBeNull();
    expect(sectionRow!.component_id).toBe("existing-component-id");
  });

  it("AS-062: linking a new component to an already-linked section replaces the old link (single-column enforcement)", async () => {
    const { linkComponentToSection } = await import("@/lib/actions/architecture");

    expect(sectionRow!.component_id).toBe("existing-component-id");

    const result = await linkComponentToSection(SECTION_ID, COMPONENT_ID);

    expect(result.success).toBe(true);
    expect(updatedTaskComponentId).toBe(COMPONENT_ID);
    expect(sectionRow!.component_id).toBe(COMPONENT_ID);
  });
});
