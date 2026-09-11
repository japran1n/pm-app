// Mission 20260910-182104, F029 (AS-058, AS-059): unlinkComponentFromSection
// (lib/actions/architecture.ts).
//
// AS-058: a single section can be unlinked from its component without
// affecting other instances.
// AS-059: a section unlinked from its component keeps its own name.
//
// Mocks follow the minimal chainable-stub convention
// tests/unit/f025-create-component.test.ts already established for this
// action file.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_A_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_B_ID = "55555555-5555-4555-8555-555555555555";
const COMPONENT_ID = "66666666-6666-4666-8666-666666666666";

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  component_id: string | null;
};

let tasks: Record<string, TaskRow>;

function resetShared() {
  tasks = {
    [SECTION_A_ID]: {
      id: SECTION_A_ID,
      project_id: PROJECT_ID,
      title: "Hero",
      component_id: COMPONENT_ID,
    },
    [SECTION_B_ID]: {
      id: SECTION_B_ID,
      project_id: PROJECT_ID,
      title: "Hero copy",
      component_id: COMPONENT_ID,
    },
  };
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
              maybeSingle: async () => {
                const row = tasks[id];
                if (!row) return { data: null, error: null };
                return {
                  data: { ...row, projects: { workspace_id: WORKSPACE_ID } },
                  error: null,
                };
              },
            }),
          }),
          update: (values: { component_id: string | null }) => ({
            eq: async (_col: string, id: string) => {
              if (tasks[id]) {
                tasks[id] = { ...tasks[id], component_id: values.component_id };
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

describe("F029 unlinkComponentFromSection", () => {
  beforeEach(() => {
    resetShared();
  });

  it("AS-058: unlinks only the targeted section, leaving other instances of the same component alone", async () => {
    const { unlinkComponentFromSection } = await import(
      "@/lib/actions/architecture"
    );

    const result = await unlinkComponentFromSection(SECTION_A_ID);

    expect(result.success).toBe(true);
    expect(tasks[SECTION_A_ID].component_id).toBeNull();
    expect(tasks[SECTION_B_ID].component_id).toBe(COMPONENT_ID);
  });

  it("AS-059: the section keeps its own name after being unlinked", async () => {
    const { unlinkComponentFromSection } = await import(
      "@/lib/actions/architecture"
    );

    const result = await unlinkComponentFromSection(SECTION_A_ID);

    expect(result.success).toBe(true);
    expect(tasks[SECTION_A_ID].title).toBe("Hero");
  });

  it("returns an error when the section does not exist", async () => {
    const { unlinkComponentFromSection } = await import(
      "@/lib/actions/architecture"
    );

    const result = await unlinkComponentFromSection("does-not-exist");

    expect(result.success).toBe(false);
  });
});
