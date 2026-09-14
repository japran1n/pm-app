// F003 (missions/20260914-portal-simplify, AS-004, AS-005): server-side
// coverage for setPageClientVisibility / setSectionClientVisibility
// (lib/actions/architecture.ts). Mocks the Supabase admin/server clients
// the same way tests/unit/f002-architecture-excludes-deleted.test.ts does,
// so the assertion exercises the actual `.update()` call sites -- deleting
// them would make this test fail, not merely a chain method disappearing.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: "owner" })),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: vi.fn(() => true),
  canEditTask: vi.fn(() => true),
}));

type Row = Record<string, unknown>;

let pageRow: Row | null;
const parentPageRow: Row | null = { client_visible: true };
let updateCalls: { table: string; payload: Row; matchId: string }[] = [];
let sectionsUpdateSelectResult: { data: Row[] | null; error: unknown };

function buildAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: pageRow, error: null })),
              })),
              // Item 10 (F004b remediation): setSectionClientVisibility
              // also looks up the parent page's client_visible directly
              // via .eq().maybeSingle(), with no .is() in between.
              maybeSingle: vi.fn(async () => ({ data: parentPageRow, error: null })),
            })),
          })),
          update: vi.fn((payload: Row) => ({
            eq: vi.fn((col: string, matchId: string) => {
              updateCalls.push({ table: "tasks", payload, matchId });
              // Distinguish the single-row update (used for the page/section
              // itself) from the sections-cascade update, which chains
              // .is().select() afterwards.
              return {
                is: vi.fn(() => ({
                  select: vi.fn(async () => sectionsUpdateSelectResult),
                })),
                then: (resolve: (v: unknown) => void) => resolve({ error: null }),
              };
            }),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => buildAdminMock()),
}));

import { setPageClientVisibility, setSectionClientVisibility } from "@/lib/actions/architecture";

beforeEach(() => {
  updateCalls = [];
  sectionsUpdateSelectResult = { data: [], error: null };
  pageRow = {
    id: "page-1",
    project_id: "proj-1",
    page_slug: "home",
    parent_task_id: null,
    projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
  };
});

describe("F003 / AS-004: setPageClientVisibility", () => {
  it("test_AS_004_marks_a_page_visible_to_the_client", async () => {
    const result = await setPageClientVisibility("00000000-0000-4000-8000-000000000001", true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clientVisible).toBe(true);
    expect(
      updateCalls.some((call) => call.table === "tasks" && call.payload.client_visible === true),
    ).toBe(true);
  });

  it("test_AS_004_unmarks_a_page_from_being_visible_to_the_client", async () => {
    const result = await setPageClientVisibility("00000000-0000-4000-8000-000000000001", false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clientVisible).toBe(false);
  });

  it("test_AS_004_sharing_a_page_can_also_share_its_sections_when_requested", async () => {
    sectionsUpdateSelectResult = { data: [{ id: "s1" }, { id: "s2" }], error: null };

    const result = await setPageClientVisibility("00000000-0000-4000-8000-000000000001", true, {
      includeSections: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sectionsShared).toBe(2);
  });

  it("test_AS_004_rejects_a_task_that_is_not_a_page", async () => {
    pageRow = {
      id: "page-1",
      project_id: "proj-1",
      page_slug: null,
      parent_task_id: "some-page",
      projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
    };

    const result = await setPageClientVisibility("00000000-0000-4000-8000-000000000001", true);

    expect(result.ok).toBe(false);
  });
});

describe("F003 / AS-004: setSectionClientVisibility", () => {
  beforeEach(() => {
    pageRow = {
      id: "section-1",
      project_id: "proj-1",
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
    };
  });

  it("test_AS_004_marks_a_section_visible_to_the_client_independently_of_its_page", async () => {
    const result = await setSectionClientVisibility(
      "00000000-0000-4000-8000-000000000002",
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clientVisible).toBe(true);
    expect(
      updateCalls.some((call) => call.table === "tasks" && call.payload.client_visible === true),
    ).toBe(true);
  });

  it("test_AS_004_unmarks_a_section_from_being_visible_to_the_client", async () => {
    const result = await setSectionClientVisibility(
      "00000000-0000-4000-8000-000000000002",
      false,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.clientVisible).toBe(false);
  });

  it("test_AS_004_rejects_a_task_that_is_not_a_section", async () => {
    pageRow = {
      id: "page-1",
      project_id: "proj-1",
      page_slug: "home",
      parent_task_id: null,
      projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
    };

    const result = await setSectionClientVisibility(
      "00000000-0000-4000-8000-000000000002",
      true,
    );

    expect(result.ok).toBe(false);
  });
});
