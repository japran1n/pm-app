// F042 (AS-138, AS-140, AS-141, AS-142, AS-143, AS-144, AS-146, AS-149):
// server-side coverage for changePageSlug (lib/actions/architecture/pages.ts).
//
// F114 fix: the previous chainable mocks (`buildSelectChain` /
// `buildAdminMock`) never recorded which columns/values `.eq()`/`.neq()`/
// `.is()` were called with -- they just returned themselves regardless of
// arguments, so deleting the project_id filter or changing the update
// target column would pass every test. This version records every filter
// call as `{ op, col, val }` tuples per query "step" (select chains AND the
// update chain), so assertions can prove the *actual* filters sent to
// Supabase, not just the final resolved value. It also asserts
// `revalidatePath` is called on success and never called on any failure
// path (AS-149).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { revalidatePath } from "next/cache";

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
  extractWorkspaceSlug: (workspaces: unknown) => {
    if (!workspaces) return null;
    if (Array.isArray(workspaces)) return (workspaces[0] as { slug?: string })?.slug ?? null;
    return (workspaces as { slug?: string }).slug ?? null;
  },
}));

let currentUser: { id: string } | null = { id: "user-1" };
const getUser = vi.fn(async () => ({ data: { user: currentUser } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

let membershipResult: { ok: boolean; role?: string } = { ok: true, role: "owner" };
vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => membershipResult),
}));

let canWriteResult = true;
vi.mock("@/lib/auth/permissions", () => ({
  canWrite: vi.fn(() => canWriteResult),
  canEditTask: vi.fn(() => true),
}));

type Row = Record<string, unknown>;
type FilterCall = { op: "eq" | "neq" | "is"; col: string; val: unknown };

let taskRow: Row | null;
let duplicateRow: Row | null;

// Records every .eq()/.neq()/.is() call made against the *uniqueness-check*
// select chain (the query that follows the task lookup).
let uniquenessFilters: FilterCall[] = [];

// Records the filter(s) applied to the update chain, and the payload it was
// called with -- one entry per `admin.from("tasks").update(payload)` call.
let updateCalls: { payload: Row; filters: FilterCall[] }[] = [];

let fromCallCount = 0;

function buildTaskLookupChain() {
  // .select(...).eq("id", taskId).is("deleted_at", null).maybeSingle()
  const chain: Record<string, unknown> = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: taskRow, error: null })),
  };
  return chain;
}

function buildUniquenessChain() {
  // .select("id").eq(project_id).eq(page_slug).neq(id).is(deleted_at).maybeSingle()
  const chain: Record<string, unknown> = {
    eq: vi.fn((col: string, val: unknown) => {
      uniquenessFilters.push({ op: "eq", col, val });
      return chain;
    }),
    neq: vi.fn((col: string, val: unknown) => {
      uniquenessFilters.push({ op: "neq", col, val });
      return chain;
    }),
    is: vi.fn((col: string, val: unknown) => {
      uniquenessFilters.push({ op: "is", col, val });
      return chain;
    }),
    maybeSingle: vi.fn(async () => ({ data: duplicateRow, error: null })),
  };
  return chain;
}

function buildUpdateChain(payload: Row) {
  const filters: FilterCall[] = [];
  const call = { payload, filters };
  updateCalls.push(call);
  const chain: Record<string, unknown> = {
    eq: vi.fn((col: string, val: unknown) => {
      filters.push({ op: "eq", col, val });
      return { error: null };
    }),
  };
  return chain;
}

function buildAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        fromCallCount += 1;
        const thisCallIndex = fromCallCount;
        return {
          select: vi.fn(() => {
            // 1st call to admin.from("tasks") is always the task lookup;
            // 2nd is the uniqueness check. Both start with `.select(...)`.
            return thisCallIndex === 1 ? buildTaskLookupChain() : buildUniquenessChain();
          }),
          update: vi.fn((payload: Row) => buildUpdateChain(payload)),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => buildAdminMock()),
}));

import { changePageSlug } from "@/lib/actions/architecture/pages";
import * as barrel from "@/lib/actions/architecture";

const TASK_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  currentUser = { id: "user-1" };
  membershipResult = { ok: true, role: "owner" };
  canWriteResult = true;
  updateCalls = [];
  uniquenessFilters = [];
  fromCallCount = 0;
  duplicateRow = null;
  taskRow = {
    id: TASK_ID,
    project_id: "proj-1",
    page_slug: "home",
    projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
  };
  vi.mocked(revalidatePath).mockClear();
});

function hasFilter(filters: FilterCall[], op: FilterCall["op"], col: string, val: unknown) {
  return filters.some((f) => f.op === op && f.col === col && f.val === val);
}

describe("F042 changePageSlug", () => {
  it("AS-138: changePageSlug is exported from the architecture barrel", () => {
    expect(typeof barrel.changePageSlug).toBe("function");
  });

  it("AS-141: rejects a slug already used by another page in the same project", async () => {
    duplicateRow = { id: "other-page" };

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/already exists/i);
    expect(updateCalls.length).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("AS-141: the uniqueness check queries project_id, page_slug, neq id, and deleted_at is null", async () => {
    duplicateRow = null;

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    expect(hasFilter(uniquenessFilters, "eq", "project_id", "proj-1")).toBe(true);
    expect(hasFilter(uniquenessFilters, "eq", "page_slug", "new-slug")).toBe(true);
    expect(hasFilter(uniquenessFilters, "neq", "id", TASK_ID)).toBe(true);
    expect(hasFilter(uniquenessFilters, "is", "deleted_at", null)).toBe(true);
  });

  it("AS-141: allows the same slug when used in a different project -- proven by the uniqueness query being scoped to THIS task's real project_id, not a wildcard", async () => {
    duplicateRow = null;
    taskRow = {
      ...taskRow,
      project_id: "proj-other",
    };

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    // The uniqueness chain was queried scoped to proj-other, not proj-1 or
    // any other project -- proving the check is project-scoped rather than
    // a global/wildcard slug check that would incorrectly reject cross-
    // project reuse.
    expect(hasFilter(uniquenessFilters, "eq", "project_id", "proj-other")).toBe(true);
    expect(hasFilter(uniquenessFilters, "eq", "project_id", "proj-1")).toBe(false);
  });

  it("AS-142: an unauthenticated caller cannot change a page's slug", async () => {
    currentUser = null;

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/signed in/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("AS-143: a viewer without write permission cannot change a page's slug", async () => {
    canWriteResult = false;

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/permission|viewers/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("AS-140/AS-149: rejects invalid input and never revalidates", async () => {
    const result = await changePageSlug(TASK_ID, "Invalid Slug!!");

    expect(result.success).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("AS-149: a successful call updates the page's slug and revalidates the layout path", async () => {
    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].payload).toEqual({ page_slug: "new-slug" });
    expect(hasFilter(updateCalls[0].filters, "eq", "id", TASK_ID)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/w", "layout");
  });
});

describe("side-effect isolation (AS-144, AS-145, AS-146)", () => {
  it("AS-144: the update call targets only id=taskId (not project_id) and touches no other rows/sections", async () => {
    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    expect(updateCalls.length).toBe(1);
    const call = updateCalls[0];
    expect(hasFilter(call.filters, "eq", "id", TASK_ID)).toBe(true);
    // Must NOT be scoped by project_id -- that would touch every page in
    // the project instead of just this one task.
    expect(call.filters.some((f) => f.col === "project_id")).toBe(false);
    expect(call.payload).toEqual({ page_slug: "new-slug" });
  });

  it("AS-145: the update payload does not touch position or page_order", async () => {
    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    expect(updateCalls.length).toBe(1);
    const payload = updateCalls[0].payload;
    expect(payload).toEqual({ page_slug: "new-slug" });
    expect(payload).not.toHaveProperty("position");
    expect(payload).not.toHaveProperty("page_order");
  });

  it("AS-146: a nested slug is written verbatim and the update is scoped to the exact taskId, not a wildcard that could cascade to child pages", async () => {
    const nestedSlug = "services/seo";

    const result = await changePageSlug(TASK_ID, nestedSlug);

    expect(result.success).toBe(true);
    expect(updateCalls.length).toBe(1);
    const call = updateCalls[0];
    // Scoped to exactly this task id via .eq("id", taskId) -- not a
    // broader/neq match that would also hit child pages (rows with
    // parent_task_id = TASK_ID).
    expect(call.filters).toEqual([{ op: "eq", col: "id", val: TASK_ID }]);
    expect(call.payload.page_slug).toBe(nestedSlug);
    // Verbatim: no parsing/splitting of the nested path into segments.
    expect(call.payload).toEqual({ page_slug: nestedSlug });
  });
});
