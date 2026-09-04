// F024b (missions/20260903-portal, AS-052): a previewing admin's session
// under `lib/supabase/server.ts`'s `createClient()` is a REAL client
// session -- Next.js Server Actions POST to the URL of the page that
// invoked them, so an action fired from any `/portal/*` page carries the
// path-scoped preview cookies and runs as the client, not the admin. This
// file exercises every named portal write path that F024's own review
// found unguarded (flagAssumption, deliverPortalDeliverable,
// createClientRequest, withdrawClientRequest, addComment) and asserts
// each is refused under a preview session, with no row written --
// `approvePortalTask`/`requestPortalTaskChanges`/`decideApproval` have
// their own coverage in tests/unit/portal-approval-action.test.ts.
//
// The guard under test (`assertNotPreview()`,
// lib/auth/assert-not-preview.ts) is the FIRST statement in every action
// below, before validation -- so an obviously-invalid payload still
// proves the guard, since a real preview session must never even reach
// the point of telling a caller their input was invalid for a write they
// were never allowed to attempt.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const PREVIEW_BLOCKED_MESSAGE =
  "You're previewing as a client. Actions are disabled in preview.";

let isPreview: boolean;
let insertCalls: { table: string; row: unknown }[];
let deleteCalls: { table: string; id: string }[];
let rpcCalls: { name: string; args: unknown }[];

function resetShared() {
  isPreview = false;
  insertCalls = [];
  deleteCalls = [];
  rpcCalls = [];
}

// --- shared @/lib/supabase/server mock: every action under test reaches
// this through `assertNotPreview()`; a few (createClientRequest,
// withdrawClientRequest) also reach it directly for their insert/delete. ---
vi.mock("@/lib/supabase/server", () => ({
  isPortalPreview: async () => isPreview,
  PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE: PREVIEW_BLOCKED_MESSAGE,
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } } }),
    },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: [{ id: "result-1", flagged_by_client_at: "2026-01-01T00:00:00Z", state: "delivered" }], error: null };
    },
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertCalls.push({ table, row });
        return {
          select: () => ({
            single: async () => ({ data: { id: "new-row-id" }, error: null }),
          }),
        };
      },
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deleteCalls.push({ table, id });
          return { error: null };
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
              single: async () => ({ data: null, error: null }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeEach(() => {
  vi.resetModules();
  resetShared();
});

describe("flagAssumption (F024b, AS-052)", () => {
  it("test_AS_052_flag_assumption_is_refused_under_a_preview_session", async () => {
    isPreview = true;
    const { flagAssumption } = await import("@/lib/actions/portal-project-records");
    const result = await flagAssumption({ assumptionId: "not-even-a-uuid", note: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(PREVIEW_BLOCKED_MESSAGE);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_052_flag_assumption_reaches_validation_when_not_previewing", async () => {
    isPreview = false;
    const { flagAssumption } = await import("@/lib/actions/portal-project-records");
    // Deliberately invalid input: proves the guard let this call PAST
    // itself (a real client would see the normal validation error here,
    // not the preview refusal).
    const result = await flagAssumption({ assumptionId: "not-a-uuid", note: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe(PREVIEW_BLOCKED_MESSAGE);
  });
});

describe("createClientRequest / withdrawClientRequest (F024b, AS-052)", () => {
  it("test_AS_052_create_client_request_is_refused_under_a_preview_session", async () => {
    isPreview = true;
    const { createClientRequest } = await import("@/lib/actions/client-requests");
    const formData = new FormData();
    formData.set("projectId", "66666666-6666-4666-8666-666666666666");
    formData.set("title", "New request");
    const result = await createClientRequest(null, formData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(PREVIEW_BLOCKED_MESSAGE);
    // The row must never have been inserted -- this is the exact defect
    // named in the review: `created_by: user.id` writing the client's id
    // from an admin's browser.
    expect(insertCalls).toHaveLength(0);
  });

  it("test_AS_052_withdraw_client_request_is_refused_under_a_preview_session", async () => {
    isPreview = true;
    const { withdrawClientRequest } = await import("@/lib/actions/client-requests");
    const result = await withdrawClientRequest("77777777-7777-4777-8777-777777777777");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(PREVIEW_BLOCKED_MESSAGE);
    expect(deleteCalls).toHaveLength(0);
  });

  it("test_AS_052_create_client_request_reaches_the_real_write_path_when_not_previewing", async () => {
    isPreview = false;
    const { createClientRequest } = await import("@/lib/actions/client-requests");
    const formData = new FormData();
    formData.set("projectId", "66666666-6666-4666-8666-666666666666");
    formData.set("title", "New request");
    const result = await createClientRequest(null, formData);
    expect(result.ok).toBe(true);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.table).toBe("client_requests");
  });
});

describe("addComment (F024b, AS-052)", () => {
  it("test_AS_052_add_comment_is_refused_under_a_preview_session", async () => {
    isPreview = true;
    const { addComment } = await import("@/lib/actions/comments");
    const result = await addComment("77777777-7777-4777-8777-777777777777", "hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(PREVIEW_BLOCKED_MESSAGE);
  });

  it("test_AS_052_add_comment_reaches_validation_when_not_previewing", async () => {
    isPreview = false;
    const { addComment } = await import("@/lib/actions/comments");
    // Empty text -- addCommentSchema's own rejection, proving the guard
    // did not fire.
    const result = await addComment("77777777-7777-4777-8777-777777777777", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe(PREVIEW_BLOCKED_MESSAGE);
  });
});

describe("deliverPortalDeliverable (F024b, AS-052)", () => {
  it("test_AS_052_deliver_portal_deliverable_is_refused_under_a_preview_session", async () => {
    isPreview = true;
    const { deliverPortalDeliverable } = await import("@/lib/actions/portal-deliverables");
    const formData = new FormData();
    formData.set("deliverableId", "88888888-8888-4888-8888-888888888888");
    formData.set("file", new File(["x"], "x.pdf", { type: "application/pdf" }));
    const result = await deliverPortalDeliverable(formData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(PREVIEW_BLOCKED_MESSAGE);
    expect(rpcCalls).toHaveLength(0);
  });

  it("test_AS_052_deliver_portal_deliverable_reaches_validation_when_not_previewing", async () => {
    isPreview = false;
    const { deliverPortalDeliverable } = await import("@/lib/actions/portal-deliverables");
    // No file attached -- proves the guard let this through to the
    // action's own "Choose a file to send." validation instead of
    // refusing for preview.
    const formData = new FormData();
    formData.set("deliverableId", "88888888-8888-4888-8888-888888888888");
    const result = await deliverPortalDeliverable(formData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe(PREVIEW_BLOCKED_MESSAGE);
  });
});
