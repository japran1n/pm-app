// F004 (missions/20260910-182104): unit tests for the architecture board
// read query (lib/queries/architecture.ts). No live DB -- `from` is
// mocked to return fixture rows so we can assert on the assembled shape
// (pages -> ordered sections -> optional linked component, plus the
// zero-instance-included component list with SQL-free, in-memory
// instance counts) and on the client sibling's extra `client_visible`
// filter, without a real Supabase connection.

import { describe, expect, it, vi, beforeEach } from "vitest";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

const PAGE_A = "00000000-0000-4000-8000-0000000000a1";
const PAGE_B = "00000000-0000-4000-8000-0000000000a2";
const SECTION_A1 = "00000000-0000-4000-8000-0000000000b1";
const SECTION_A2 = "00000000-0000-4000-8000-0000000000b2";
const SECTION_B1 = "00000000-0000-4000-8000-0000000000b3";
const COMPONENT_1 = "00000000-0000-4000-8000-0000000000c1";
const COMPONENT_2 = "00000000-0000-4000-8000-0000000000c2";

const taskRows = [
  { id: PAGE_B, title: "Contact", page_slug: "/contact", page_kind: "static", component_id: null, parent_task_id: null, position: 1 },
  { id: PAGE_A, title: "Home", page_slug: "/", page_kind: "static", component_id: null, parent_task_id: null, position: 0 },
  { id: SECTION_A2, title: "Footer", page_slug: null, page_kind: null, component_id: COMPONENT_1, parent_task_id: PAGE_A, position: 1 },
  { id: SECTION_A1, title: "Hero", page_slug: null, page_kind: null, component_id: COMPONENT_1, parent_task_id: PAGE_A, position: 0 },
  { id: SECTION_B1, title: "Form", page_slug: null, page_kind: null, component_id: null, parent_task_id: PAGE_B, position: 0 },
  // A non-page, non-section task (no page_slug, no parent) must be ignored.
  { id: "00000000-0000-4000-8000-0000000000d1", title: "Unrelated task", page_slug: null, page_kind: null, component_id: null, parent_task_id: null, position: 0 },
];

const componentRows = [
  { id: COMPONENT_1, name: "Footer", description: "Shared footer", position: 0 },
  { id: COMPONENT_2, name: "Unused banner", description: null, position: 1 },
];

type Chainable = {
  eq: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (v: unknown) => unknown) => unknown;
};

type TasksChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  __setError: (error: { message: string } | null) => void;
};

type ComponentsChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
};

let tasksQuery: TasksChain;
let componentsQuery: ComponentsChain;
let fromMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: fromMock,
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();

  // A single shared `eq` spy that returns a chainable, thenable object --
  // supports both `.eq(...).eq(...)` (client read, two filters) and
  // awaiting directly after one `.eq(...)` (team read, one filter). The
  // spy call count is what "no N+1 / correct filters" assertions check.
  const currentTaskRows = taskRows;
  const eqSpy = vi.fn();
  const chainable: Chainable = {
    eq: eqSpy,
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: currentTaskRows, error: null }).then(onFulfilled),
  };
  eqSpy.mockImplementation(() => chainable);

  const selectSpy = vi.fn();
  const tasksChain: TasksChain = {
    select: selectSpy,
    eq: eqSpy,
    __setError: (error: { message: string } | null) => {
      chainable.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: error ? null : currentTaskRows, error }).then(onFulfilled);
    },
  };
  selectSpy.mockReturnValue(tasksChain);
  tasksQuery = tasksChain;

  const componentsSelectSpy = vi.fn();
  const componentsEqSpy = vi.fn();
  const componentsChain: ComponentsChain = {
    select: componentsSelectSpy,
    eq: componentsEqSpy,
  };
  componentsSelectSpy.mockReturnValue(componentsChain);
  componentsEqSpy.mockImplementation(() => Promise.resolve({ data: componentRows, error: null }));
  componentsQuery = componentsChain;

  fromMock = vi.fn((table: string) => {
    if (table === "tasks") return tasksQuery;
    if (table === "page_components") return componentsQuery;
    throw new Error(`unexpected table: ${table}`);
  });
});

import { getArchitectureBoard, getArchitectureBoardForClient } from "@/lib/queries/architecture";

describe("F004: getArchitectureBoard", () => {
  it("test_AS_board_returns_pages_ordered_by_position_with_page_shape", async () => {
    const result = await getArchitectureBoard(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.pages.map((p) => p.id)).toEqual([PAGE_A, PAGE_B]);
    expect(result.data.pages[0]).toMatchObject({
      id: PAGE_A,
      title: "Home",
      pageSlug: "/",
      pageKind: "static",
      position: 0,
    });
  });

  it("test_AS_board_returns_sections_in_position_order_with_optional_linked_component", async () => {
    const result = await getArchitectureBoard(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const home = result.data.pages.find((p) => p.id === PAGE_A);
    expect(home?.sections.map((s) => s.id)).toEqual([SECTION_A1, SECTION_A2]);
    expect(home?.sections[0]?.component).toEqual({ id: COMPONENT_1, name: "Footer" });

    const contact = result.data.pages.find((p) => p.id === PAGE_B);
    expect(contact?.sections[0]?.component).toBeNull();
  });

  it("test_AS_board_excludes_non_page_non_section_tasks", async () => {
    const result = await getArchitectureBoard(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const allIds = result.data.pages.map((p) => p.id);
    expect(allIds).not.toContain("00000000-0000-4000-8000-0000000000d1");
  });

  it("test_AS_board_includes_zero_instance_components_with_correct_instance_counts", async () => {
    const result = await getArchitectureBoard(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const componentsById = new Map(result.data.components.map((c) => [c.id, c]));
    expect(componentsById.get(COMPONENT_1)?.instanceCount).toBe(2);
    expect(componentsById.get(COMPONENT_2)?.instanceCount).toBe(0);
    expect(result.data.components).toHaveLength(2);
  });

  it("test_AS_board_issues_exactly_one_query_per_table_no_n_plus_1", async () => {
    await getArchitectureBoard(PROJECT_ID);
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(fromMock).toHaveBeenCalledWith("tasks");
    expect(fromMock).toHaveBeenCalledWith("page_components");
    // Team read: exactly one `eq` (project_id) on tasks -- no per-page or
    // per-section follow-up queries.
    expect(tasksQuery.eq).toHaveBeenCalledTimes(1);
    expect(tasksQuery.eq).toHaveBeenCalledWith("project_id", PROJECT_ID);
  });
});

describe("F004: getArchitectureBoardForClient", () => {
  it("test_AS_board_client_read_applies_client_visible_filter_on_top_of_project_id", async () => {
    const result = await getArchitectureBoardForClient(PROJECT_ID);
    expect(result.ok).toBe(true);

    expect(tasksQuery.eq).toHaveBeenCalledTimes(2);
    expect(tasksQuery.eq).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect(tasksQuery.eq).toHaveBeenCalledWith("client_visible", true);
  });

  it("test_AS_board_client_read_still_includes_zero_instance_components", async () => {
    const result = await getArchitectureBoardForClient(PROJECT_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const componentsById = new Map(result.data.components.map((c) => [c.id, c]));
    expect(componentsById.get(COMPONENT_2)?.instanceCount).toBe(0);
  });
});

describe("F004: error propagation", () => {
  it("test_AS_board_returns_error_when_tasks_query_fails", async () => {
    tasksQuery.__setError({ message: "boom" });
    const result = await getArchitectureBoard(PROJECT_ID);
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("test_AS_board_returns_error_when_components_query_fails", async () => {
    componentsQuery.eq.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: "components boom" } }),
    );
    const result = await getArchitectureBoard(PROJECT_ID);
    expect(result).toEqual({ ok: false, error: "components boom" });
  });
});
