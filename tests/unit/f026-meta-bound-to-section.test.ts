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
import React from "react";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

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
  // only task_id differs, which is exactly the thing under test. SECTION_A
  // and SECTION_B are modelled as real siblings under PAGE_TASK_ID via
  // parent_task_id, so the page->section relationship exists in the fixture
  // (previously absent, which let page-derived keying bugs go undetected).
  const parentTaskId =
    taskId === SECTION_A_TASK_ID || taskId === SECTION_B_TASK_ID ? PAGE_TASK_ID : null;
  return {
    id: taskId,
    project_id: PROJECT_ID,
    parent_task_id: parentTaskId,
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

describe("F026 / AS-093: section-to-section meta isolation is real, not clobbered by write order", () => {
  it("test_AS_093_meta_for_section_a_does_not_appear_on_section_b_order_a_then_b", async () => {
    // SECTION_A and SECTION_B are siblings under the SAME page (PAGE_TASK_ID)
    // per taskRowFor's parent_task_id wiring. If setNodeMeta or
    // getArchitectureNodeDetails ever resolved a section's meta via its
    // parent page's task_id instead of section.id, both writes below would
    // collide on PAGE_TASK_ID and B would read back A's values (or vice
    // versa). Going through getArchitectureNodeDetails -- never
    // metaByTaskId directly -- means this test exercises the real read
    // path, not the test's own write mock.
    await setNodeMeta(SECTION_A_TASK_ID, { intent: "Only for A", audience: "A's audience" });
    await setNodeMeta(SECTION_B_TASK_ID, { intent: "Only for B", audience: "B's audience" });

    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionADetails = result.data.get(SECTION_A_TASK_ID);
    const sectionBDetails = result.data.get(SECTION_B_TASK_ID);

    expect(sectionADetails?.meta?.intent).toBe("Only for A");
    expect(sectionADetails?.meta?.audience).toBe("A's audience");
    expect(sectionBDetails?.meta?.intent).toBe("Only for B");
    expect(sectionBDetails?.meta?.audience).toBe("B's audience");
    expect(sectionADetails?.meta?.intent).not.toBe(sectionBDetails?.meta?.intent);
    // The page itself never had meta written -- if either section's write
    // had keyed on the shared parent, the page entry would exist.
    expect(result.data.get(PAGE_TASK_ID)).toBeUndefined();
  });

  it("test_AS_093_meta_for_section_a_does_not_appear_on_section_b_order_b_then_a", async () => {
    // Same assertion, reversed write order -- rules out a bug that only
    // manifests depending on which sibling is written first (e.g. a naive
    // "first write wins the shared key" implementation).
    await setNodeMeta(SECTION_B_TASK_ID, { intent: "Only for B", audience: "B's audience" });
    await setNodeMeta(SECTION_A_TASK_ID, { intent: "Only for A", audience: "A's audience" });

    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionADetails = result.data.get(SECTION_A_TASK_ID);
    const sectionBDetails = result.data.get(SECTION_B_TASK_ID);

    expect(sectionADetails?.meta?.intent).toBe("Only for A");
    expect(sectionADetails?.meta?.audience).toBe("A's audience");
    expect(sectionBDetails?.meta?.intent).toBe("Only for B");
    expect(sectionBDetails?.meta?.audience).toBe("B's audience");
    expect(sectionADetails?.meta?.intent).not.toBe(sectionBDetails?.meta?.intent);
  });
});

describe("F026 / AS-094: page meta and its section's meta are independently retained", () => {
  it("test_AS_094_page_and_section_meta_each_retain_their_own_intent_through_getArchitectureNodeDetails", async () => {
    // PAGE_TASK_ID is the real parent of SECTION_A_TASK_ID (via
    // parent_task_id in taskRowFor). Writing meta to both and reading back
    // exclusively through getArchitectureNodeDetails would fail if the
    // page's write ever overwrote the section's row (or vice versa) because
    // of shared/derived keying.
    await setNodeMeta(PAGE_TASK_ID, { intent: "Page intent" });
    await setNodeMeta(SECTION_A_TASK_ID, { intent: "Section intent" });

    const result = await getArchitectureNodeDetails(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pageDetails = result.data.get(PAGE_TASK_ID);
    const sectionDetails = result.data.get(SECTION_A_TASK_ID);

    expect(pageDetails?.meta?.intent).toBe("Page intent");
    expect(sectionDetails?.meta?.intent).toBe("Section intent");
    expect(pageDetails?.meta?.intent).not.toBe(sectionDetails?.meta?.intent);

    // Overwriting the page's meta afterwards must not touch the section's --
    // and re-fetching must reflect the update for the page only.
    await setNodeMeta(PAGE_TASK_ID, { intent: "Updated page intent" });
    const refetched = await getArchitectureNodeDetails(PROJECT_ID);
    expect(refetched.ok).toBe(true);
    if (!refetched.ok) return;

    expect(refetched.data.get(PAGE_TASK_ID)?.meta?.intent).toBe("Updated page intent");
    expect(refetched.data.get(SECTION_A_TASK_ID)?.meta?.intent).toBe("Section intent");
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
          React.createElement("div", {
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
      React.createElement(SectionCard, {
        section: makeSection("section-task-abc", "Hero"),
        detailsData,
        onDetailsInvalidate: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy brief for hero/i }));

    const firstDialog = await screen.findByTestId("node-meta-dialog-stub");
    expect(firstDialog.getAttribute("data-task-id")).toBe("section-task-abc");
    expect(firstDialog.getAttribute("data-task-id")).not.toBe("wrong-id");

    unmount();
    cleanup();

    render(
      React.createElement(SectionCard, {
        section: makeSection("section-task-xyz", "Footer"),
        detailsData,
        onDetailsInvalidate: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy brief for footer/i }));

    const secondDialog = await screen.findByTestId("node-meta-dialog-stub");
    expect(secondDialog.getAttribute("data-task-id")).toBe("section-task-xyz");
    expect(secondDialog.getAttribute("data-task-id")).not.toBe("section-task-abc");

    cleanup();
  });
});
