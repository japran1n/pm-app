// @vitest-environment jsdom
// F026 (missions/20260919-150607, AS-091..AS-094): node_meta rows are keyed
// on a section's OWN task_id, not its parent page's task_id. F025 wired
// NodeMetaDialog to open with `taskId={section.id}` (components/architecture/
// section-card.tsx) and setNodeMeta / getArchitectureNodeDetails both key
// exclusively on task_id -- but nothing exercised that end-to-end before
// this feature. These tests would fail if a future refactor started
// resolving a section's meta via its parent page's task_id instead of its
// own (a plausible mistake since "section IS a subtask of its page" is the
// standing decision that makes it tempting to key everything off the page).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/actions/portal-revalidate", () => ({
  revalidatePortalProject: vi.fn(),
  extractWorkspaceSlug: vi.fn((workspaces: unknown) => {
    if (Array.isArray(workspaces)) return workspaces[0]?.slug;
    return (workspaces as { slug?: string } | null)?.slug;
  }),
}));

const getUser = vi.fn(async () => ({ user: { id: "user-1" } }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => getUser()),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: "owner" })),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: vi.fn(() => true),
}));

const PAGE_TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECTION_A_TASK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECTION_B_TASK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

// In-memory store standing in for the architecture_node_meta table, keyed
// by task_id -- mirrors the real table's PK / upsert(onConflict: "task_id").
let metaByTaskId: Map<string, Row>;

function taskRowFor(taskId: string): Row {
  // Every task (page or section) resolves to the same project/workspace --
  // only task_id differs, which is exactly the thing under test.
  return {
    id: taskId,
    project_id: PROJECT_ID,
    projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
  };
}

function buildAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, taskId: string) => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: taskRowFor(taskId), error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "architecture_node_meta") {
        return {
          upsert: vi.fn((payload: Row, _opts: { onConflict: string }) => {
            metaByTaskId.set(payload.task_id as string, {
              ...(metaByTaskId.get(payload.task_id as string) ?? {}),
              ...payload,
            });
            return Promise.resolve({ error: null });
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => buildAdminMock()),
}));

function buildFilterableQuery(rows: Row[]) {
  const query: Record<string, unknown> = {
    eq: vi.fn((column: string, value: unknown) =>
      buildFilterableQuery(rows.filter((row) => row[column] === value)),
    ),
    not: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  (query as unknown as PromiseLike<unknown>).then = ((
    onfulfilled?: ((value: unknown) => unknown) | null,
  ) =>
    Promise.resolve(
      onfulfilled ? onfulfilled({ data: rows, error: null }) : { data: rows, error: null },
    )) as PromiseLike<unknown>["then"];
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "task_discipline_estimates") {
        return { select: vi.fn(() => buildFilterableQuery([])) };
      }
      if (table === "architecture_node_meta") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async (_col: string, projectId: string) => ({
              data: [...metaByTaskId.values()].filter((row) => row.project_id === projectId),
              error: null,
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { setNodeMeta } from "@/lib/actions/architecture";
import { getArchitectureNodeDetails } from "@/lib/queries/architecture-details";

beforeEach(() => {
  metaByTaskId = new Map();
  getUser.mockImplementation(async () => ({ user: { id: "user-1" } }));
});

describe("F026 / AS-091: saving meta for a section uses the section's own task_id as the key", () => {
  it("test_AS_091_saving_meta_for_a_section_uses_the_sections_own_task_id_as_the_key", async () => {
    const result = await setNodeMeta(SECTION_A_TASK_ID, { intent: "Section A intent" });

    expect(result.success).toBe(true);
    expect(metaByTaskId.has(SECTION_A_TASK_ID)).toBe(true);
    expect(metaByTaskId.has(PAGE_TASK_ID)).toBe(false);
    expect(metaByTaskId.get(SECTION_A_TASK_ID)?.intent).toBe("Section A intent");
  });
});

describe("F026 / AS-092: a page and its section can have independent meta", () => {
  it("test_AS_092_a_page_and_its_section_can_have_independent_meta", async () => {
    const pageResult = await setNodeMeta(PAGE_TASK_ID, { intent: "Page intent" });
    const sectionResult = await setNodeMeta(SECTION_A_TASK_ID, { intent: "Section intent" });

    expect(pageResult.success).toBe(true);
    expect(sectionResult.success).toBe(true);

    expect(metaByTaskId.get(PAGE_TASK_ID)?.intent).toBe("Page intent");
    expect(metaByTaskId.get(SECTION_A_TASK_ID)?.intent).toBe("Section intent");
    expect(metaByTaskId.get(PAGE_TASK_ID)?.intent).not.toBe(
      metaByTaskId.get(SECTION_A_TASK_ID)?.intent,
    );
  });
});

describe("F026 / AS-093: meta for section A doesn't appear on section B", () => {
  it("test_AS_093_meta_for_section_a_does_not_appear_on_section_b", async () => {
    await setNodeMeta(SECTION_A_TASK_ID, {
      intent: "Only for A",
      audience: "A's audience",
    });

    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionADetails = result.data.get(SECTION_A_TASK_ID);
    const sectionBDetails = result.data.get(SECTION_B_TASK_ID);

    expect(sectionADetails?.meta?.intent).toBe("Only for A");
    // Section B never had meta written -- it must not inherit or leak A's
    // meta, and must not even appear in the details map.
    expect(sectionBDetails).toBeUndefined();
  });
});

describe("F026 / AS-094: meta persists across re-fetches for the correct task_id", () => {
  it("test_AS_094_meta_persists_across_refetches_for_the_correct_task_id", async () => {
    await setNodeMeta(SECTION_A_TASK_ID, { intent: "Persisted intent", tone: "Direct" });

    const firstFetch = await getArchitectureNodeDetails(PROJECT_ID);
    const secondFetch = await getArchitectureNodeDetails(PROJECT_ID);

    expect(firstFetch.ok).toBe(true);
    expect(secondFetch.ok).toBe(true);
    if (!firstFetch.ok || !secondFetch.ok) return;

    expect(firstFetch.data.get(SECTION_A_TASK_ID)?.meta?.intent).toBe("Persisted intent");
    expect(secondFetch.data.get(SECTION_A_TASK_ID)?.meta?.intent).toBe("Persisted intent");
    expect(secondFetch.data.get(SECTION_A_TASK_ID)?.meta?.tone).toBe("Direct");
  });
});

// AS-091 (render coverage): the assertion is about the *saved meta being
// keyed on the section's own task_id*, but F025 wires that key in purely
// through a prop -- `<NodeMetaDialog taskId={section.id} ...>` in
// components/architecture/section-card.tsx. Nothing above exercises that
// wiring; a refactor that swapped `section.id` for e.g. a parent page id
// would still pass every test above (they call setNodeMeta directly).
// This block renders SectionCard for two different sections and asserts
// the dialog actually receives each section's own id as `taskId`.
describe("F025/AS-091 (render): NodeMetaDialog opens with the section's own task_id", () => {
  it("test_AS_091_node_meta_dialog_receives_the_clicked_sections_own_task_id", async () => {
    vi.resetModules();

    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
      useParams: () => ({ projectId: "project-1" }),
    }));

    vi.doMock("sonner", () => ({
      toast: { error: vi.fn(), success: vi.fn() },
    }));

    vi.doMock("@/lib/actions/architecture", () => ({
      renameSection: vi.fn(),
    }));

    // Replace the real NodeMetaDialog with a stub that just surfaces the
    // `taskId` prop it was given as a data attribute, so the test can
    // assert on it without depending on the dialog's own internals.
    vi.doMock("@/components/architecture/node-meta-dialog", () => ({
      NodeMetaDialog: ({ taskId, open }: { taskId: string; open: boolean }) =>
        open ? (
          require("react").createElement("div", {
            "data-testid": "node-meta-dialog-stub",
            "data-task-id": taskId,
          })
        ) : null,
    }));

    const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");
    await import("@testing-library/jest-dom/vitest");
    const { SectionCard } = await import("@/components/architecture/section-card");
    const detailsModule = await import("@/lib/architecture/types");
    void detailsModule;

    function makeSection(id: string, title: string) {
      return {
        id,
        title,
        position: 1,
        kind: "static" as const,
        component: null,
      };
    }

    const detailsData = new Map<string, { meta: null; estimates: [] }>();

    const { unmount } = render(
      require("react").createElement(SectionCard, {
        section: makeSection("section-task-abc", "Hero"),
        detailsData,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy brief for hero/i }));

    const firstDialog = await screen.findByTestId("node-meta-dialog-stub");
    expect(firstDialog.getAttribute("data-task-id")).toBe("section-task-abc");
    expect(firstDialog.getAttribute("data-task-id")).not.toBe("wrong-id");

    unmount();
    cleanup();

    render(
      require("react").createElement(SectionCard, {
        section: makeSection("section-task-xyz", "Footer"),
        detailsData,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy brief for footer/i }));

    const secondDialog = await screen.findByTestId("node-meta-dialog-stub");
    expect(secondDialog.getAttribute("data-task-id")).toBe("section-task-xyz");
    expect(secondDialog.getAttribute("data-task-id")).not.toBe("section-task-abc");

    cleanup();
  });
});
