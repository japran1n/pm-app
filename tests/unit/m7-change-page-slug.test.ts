// F042 (AS-138, AS-141, AS-142, AS-143, AS-149): server-side coverage for
// changePageSlug (lib/actions/architecture/pages.ts). Mocks the Supabase
// admin/server clients the same way
// tests/unit/f003-set-page-section-client-visibility-action.test.ts does,
// so the assertions exercise the actual query/update call sites.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

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

let taskRow: Row | null;
let duplicateRow: Row | null;
let updateCalls: { table: string; payload: Row; matchId: string }[] = [];

// Generic chainable query builder: tracks whether `.neq()` was called
// anywhere in the chain to distinguish the task lookup (no `.neq()`) from
// the slug-uniqueness check (`.eq().eq().neq().is().maybeSingle()`), since
// both queries share the same `select().eq()...` prefix.
function buildSelectChain(hasNeq: boolean) {
  const chain: Record<string, unknown> = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    neq: vi.fn(() => buildSelectChain(true)),
    maybeSingle: vi.fn(async () =>
      hasNeq
        ? { data: duplicateRow, error: null }
        : { data: taskRow, error: null },
    ),
  };
  return chain;
}

function buildAdminMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => buildSelectChain(false)),
          update: vi.fn((payload: Row) => ({
            eq: vi.fn((_col: string, matchId: string) => {
              updateCalls.push({ table: "tasks", payload, matchId });
              return { error: null };
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

import { changePageSlug } from "@/lib/actions/architecture/pages";
import * as barrel from "@/lib/actions/architecture";

const TASK_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  currentUser = { id: "user-1" };
  membershipResult = { ok: true, role: "owner" };
  canWriteResult = true;
  updateCalls = [];
  duplicateRow = null;
  taskRow = {
    id: TASK_ID,
    project_id: "proj-1",
    page_slug: "home",
    projects: { workspace_id: "ws-1", workspaces: { slug: "acme" } },
  };
});

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
  });

  it("AS-141: allows the same slug when used in a different project", async () => {
    duplicateRow = null;

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
  });

  it("AS-142: an unauthenticated caller cannot change a page's slug", async () => {
    currentUser = null;

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/signed in/i);
  });

  it("AS-143: a viewer without write permission cannot change a page's slug", async () => {
    canWriteResult = false;

    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/permission|viewers/i);
  });

  it("AS-149: a successful call updates the page's slug", async () => {
    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    expect(
      updateCalls.some(
        (call) =>
          call.table === "tasks" &&
          call.payload.page_slug === "new-slug" &&
          call.matchId === TASK_ID,
      ),
    ).toBe(true);
  });
});

describe("side-effect isolation (AS-144, AS-145, AS-146)", () => {
  it("AS-144: the update call targets only the given taskId and touches no other rows/sections", async () => {
    const result = await changePageSlug(TASK_ID, "new-slug");

    expect(result.success).toBe(true);
    expect(updateCalls.length).toBe(1);
    const call = updateCalls[0];
    expect(call.table).toBe("tasks");
    expect(call.matchId).toBe(TASK_ID);
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
    // Scoped to exactly this task id — not a broader/neq match that would
    // also hit child pages (rows with parent_task_id = TASK_ID).
    expect(call.matchId).toBe(TASK_ID);
    expect(call.payload.page_slug).toBe(nestedSlug);
    // Verbatim: no parsing/splitting of the nested path into segments.
    expect(call.payload).toEqual({ page_slug: nestedSlug });
  });
});
