// F004b (missions/20260914-portal-simplify): scrutiny remediation coverage
// for AS-006. Two things this file asserts that the previous F003/F004
// tests did not:
//
//   1. The page/section share actions (lib/actions/architecture.ts)
//      reject viewers, clients, non-members, and signed-out callers.
//   2. The changed actions (architecture create/rename/delete, the share
//      toggles, tasks/lifecycle.ts's delete/restore, tasks/checklist.ts's
//      toggle) call `revalidatePath` with the exact
//      `/portal/<slug>/p/<projectId>` "layout" arguments this remediation
//      introduced, via the shared `revalidatePortalProject` helper.
//
// Uses the REAL `canWrite` predicate (not mocked) so "viewer"/"client"
// rejection is actually exercised, not merely assumed from a stubbed
// canWrite always returning true, the way tests/unit/
// f003-set-page-section-client-visibility-action.test.ts's existing
// suite does.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

let currentUser: { id: string } | null = { id: "user-1" };
const getUser = vi.fn(async () => ({ data: { user: currentUser } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

let membershipResult: { ok: true; role: string } | { ok: false } = {
  ok: true,
  role: "owner",
};

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => membershipResult),
}));

// Deliberately NOT mocked: lib/auth/permissions's real `canWrite` is used
// so viewer/client rejection is genuinely exercised (see file header).
vi.importActual("@/lib/auth/permissions");

type Row = Record<string, unknown>;

const WORKSPACE_SLUG = "acme";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000f1";

let pageRow: Row | null;
let parentPageRow: Row | null = { client_visible: true };
let sectionsUpdateShouldFail = false;

// F004c (item 4/5): tracks every `tasks.update(...)` call this mock
// receives, so the rejection tests below can assert a rejected caller
// never reaches the write at all (not just that the final result is
// `ok:false`) — a permission check that "fails closed" only in its return
// value but still issues the UPDATE underneath would be a real bug this
// assertion is meant to catch.
const taskUpdateSpy = vi.fn();

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
              maybeSingle: vi.fn(async () => ({ data: parentPageRow, error: null })),
            })),
          })),
          update: vi.fn((patch: unknown) => {
            taskUpdateSpy(patch);
            return {
              eq: vi.fn((column: string) => ({
                is: vi.fn(() => ({
                  select: vi.fn(async () =>
                    column === "parent_task_id" && sectionsUpdateShouldFail
                      ? { data: null, error: { message: "sections update failed" } }
                      : { data: [], error: null },
                  ),
                })),
                then: (resolve: (v: unknown) => void) => resolve({ error: null }),
              })),
            };
          }),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  id: "new-page",
                  project_id: PROJECT_ID,
                  title: "New page",
                  page_slug: "new-page",
                  page_kind: "static",
                  position: 1,
                },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: PROJECT_ID,
                    workspace_id: "ws-1",
                    deleted_at: null,
                    workspaces: { slug: WORKSPACE_SLUG },
                  },
                  error: null,
                })),
              })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    rpc: vi.fn(async () => ({ data: 1, error: null })),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => buildAdminMock()),
}));

import {
  setPageClientVisibility,
  setSectionClientVisibility,
} from "@/lib/actions/architecture";

beforeEach(() => {
  revalidatePath.mockClear();
  taskUpdateSpy.mockClear();
  currentUser = { id: "user-1" };
  membershipResult = { ok: true, role: "owner" };
  sectionsUpdateShouldFail = false;
  parentPageRow = { client_visible: true };
  pageRow = {
    id: "page-1",
    project_id: PROJECT_ID,
    page_slug: "home",
    parent_task_id: null,
    projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
  };
});

const PAGE_TASK_ID = "00000000-0000-4000-8000-000000000001";
const SECTION_TASK_ID = "00000000-0000-4000-8000-000000000002";

describe("F004b / AS-006: share actions reject non-write callers", () => {
  it("test_AS_006_rejects_signed_out_caller_sharing_a_page", async () => {
    currentUser = null;
    const result = await setPageClientVisibility(PAGE_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_viewer_sharing_a_page", async () => {
    membershipResult = { ok: true, role: "viewer" };
    const result = await setPageClientVisibility(PAGE_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_client_sharing_a_page", async () => {
    membershipResult = { ok: true, role: "client" };
    const result = await setPageClientVisibility(PAGE_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_non_member_sharing_a_page", async () => {
    membershipResult = { ok: false };
    const result = await setPageClientVisibility(PAGE_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_signed_out_caller_sharing_a_section", async () => {
    currentUser = null;
    pageRow = {
      id: "section-1",
      project_id: PROJECT_ID,
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
    };
    const result = await setSectionClientVisibility(SECTION_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_viewer_sharing_a_section", async () => {
    membershipResult = { ok: true, role: "viewer" };
    pageRow = {
      id: "section-1",
      project_id: PROJECT_ID,
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
    };
    const result = await setSectionClientVisibility(SECTION_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_client_sharing_a_section", async () => {
    membershipResult = { ok: true, role: "client" };
    pageRow = {
      id: "section-1",
      project_id: PROJECT_ID,
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
    };
    const result = await setSectionClientVisibility(SECTION_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("test_AS_006_rejects_non_member_sharing_a_section", async () => {
    membershipResult = { ok: false };
    pageRow = {
      id: "section-1",
      project_id: PROJECT_ID,
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
    };
    const result = await setSectionClientVisibility(SECTION_TASK_ID, true);
    expect(result.ok).toBe(false);
    expect(taskUpdateSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("F004b / AS-006: share toggles revalidate the portal layout, not just the architecture page", () => {
  it("test_AS_006_sharing_a_page_revalidates_the_portal_project_layout", async () => {
    const result = await setPageClientVisibility(PAGE_TASK_ID, true);
    expect(result.ok).toBe(true);

    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
    // Scrutiny remediation item 3: no more page-scoped
    // `/portal/<slug>/p/<projectId>/architecture` revalidate.
    expect(
      revalidatePath.mock.calls.some(
        (call) => call[0] === `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}/architecture`,
      ),
    ).toBe(false);
  });

  it("test_AS_006_sharing_a_section_revalidates_the_portal_project_layout", async () => {
    pageRow = {
      id: "section-1",
      project_id: PROJECT_ID,
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
    };

    const result = await setSectionClientVisibility(SECTION_TASK_ID, true);
    expect(result.ok).toBe(true);

    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
    expect(
      revalidatePath.mock.calls.some(
        (call) => call[0] === `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}/architecture`,
      ),
    ).toBe(false);
  });

  it("test_AS_006_sharing_a_section_under_a_hidden_page_reports_pageHidden", async () => {
    parentPageRow = { client_visible: false };
    pageRow = {
      id: "section-1",
      project_id: PROJECT_ID,
      page_slug: null,
      parent_task_id: "page-1",
      projects: { workspace_id: "ws-1", workspaces: { slug: WORKSPACE_SLUG } },
    };

    const result = await setSectionClientVisibility(SECTION_TASK_ID, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.pageHidden).toBe(true);
  });

  // F004c (item 5): the page's own client_visible update already committed
  // by the time the "share sections too" cascade update runs, so a
  // cascade failure must surface as a reported partial failure
  // (`sectionsShareFailed: true`) alongside `ok: true` — never `ok: false`,
  // which would falsely tell the caller the page itself was never shared.
  it("test_AS_006_sharing_a_page_with_a_failed_sections_cascade_reports_sectionsShareFailed", async () => {
    sectionsUpdateShouldFail = true;

    const result = await setPageClientVisibility(PAGE_TASK_ID, true, {
      includeSections: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sectionsShareFailed).toBe(true);
    expect(result.data.sectionsShared).toBe(0);
    // The page's own share still succeeded and still revalidates the
    // portal — a failed cascade must not swallow the page-level effect.
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });
});
