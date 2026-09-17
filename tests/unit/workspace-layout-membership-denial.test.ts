// F043 (M1-scrutiny follow-up, AS-003 / AS-004): unit-level mutation-safe
// guard test for the converter tool route's access control.
//
// AS-002/AS-003/AS-004's own doc comment in
// app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx explains that
// the converter page adds zero auth/membership logic of its own -- it
// inherits access control entirely from the enclosing
// app/(workspace)/w/[workspaceSlug]/layout.tsx segment layout, the same
// convention tests/unit/f039-portal-guards.test.ts already uses to unit
// test the portal's equivalent shared guard.
//
// tests/integration/workspace-not-found-scope.test.ts (F023, AS-144)
// already covers the RLS-level guarantee that a nonexistent slug and an
// existing-but-not-a-member slug resolve identically -- but only against a
// live Supabase project, and only at the query layer, not by actually
// calling the layout function. That integration suite is also skipped
// entirely whenever Supabase admin credentials aren't present in the test
// environment (see tests/setup + missions/20260917-170249/handoffs/
// F046-handoff.md for the confirmed, pre-existing, unrelated reason the
// broader tests/integration/** suite doesn't run headless here), so a
// membership-denial regression in the layout itself could land with zero
// red tests anywhere in the always-on unit suite. This file closes that
// gap: it renders (calls) WorkspaceLayout directly with the converter page
// as `children`, a signed-in non-member user, and asserts `notFound()` is
// what actually fires -- independent of any live database.
//
// Mutation-tested per this feature's acceptance criterion: temporarily
// deleting the layout's `if (!activeWorkspace) { ... notFound(); }` guard
// makes this test's `.rejects.toThrow("NEXT_NOT_FOUND")` assertion fail
// (the call resolves instead of throwing, because nothing stops the layout
// body from continuing past a null `activeWorkspace`). Restoring the guard
// makes it pass again. See F043 handoff for the verification transcript.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { notFound, redirect, permanentRedirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  permanentRedirect: vi.fn(() => {
    throw new Error("NEXT_PERMANENT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ notFound, redirect, permanentRedirect }));

let currentUser: { id: string; email: string } | null;
// AS-003/AS-144: the layout resolves the active workspace via
// `getWorkspaceBySlug`, which is itself scoped by the
// `workspaces_select_active_members` RLS policy -- a non-member and a
// nonexistent slug both resolve to `null` here, exactly like F023's
// integration test asserts at the query layer.
let activeWorkspace: { id: string; name: string; slug: string; logo_url: string | null } | null;

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({
    supabase: {
      // `WorkspaceLayout` looks up `workspace_slug_history` before giving
      // up with `notFound()`, to redirect visitors of a RETIRED slug (see
      // that layout's own file-header comment) -- empty here, so this
      // lookup falls through to the generic 404 for a slug with no
      // history either.
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      })),
    },
    user: currentUser,
  })),
}));

vi.mock("@/lib/queries/workspaces", () => ({
  getWorkspaceBySlug: vi.fn(async () => activeWorkspace),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import WorkspaceLayout from "@/app/(workspace)/w/[workspaceSlug]/layout";
import WebflowConverterPage from "@/app/(workspace)/w/[workspaceSlug]/tools/webflow/page";

describe("F043 / AS-003, AS-004: WorkspaceLayout denies a non-member access to the converter route", () => {
  beforeEach(() => {
    notFound.mockClear();
    redirect.mockClear();
    permanentRedirect.mockClear();
    currentUser = { id: "user-not-mine", email: "not-a-member@example.com" };
    activeWorkspace = null;
  });

  it("AS-003: calls notFound() when rendering the converter page under a workspace the signed-in user isn't an active member of", async () => {
    await expect(
      WorkspaceLayout({
        children: WebflowConverterPage(),
        params: Promise.resolve({ workspaceSlug: "not-mine" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });
});
