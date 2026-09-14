// F039 (missions/20260910-182104, AS-095, AS-096): the portal Architecture
// route (app/(portal)/portal/[workspaceSlug]/p/[projectId]/architecture/
// page.tsx, shipped by F037) has no guard of its own -- it inherits its
// access control entirely from the enclosing
// `p/[projectId]/layout.tsx`, the same convention every sibling view
// under that layout relies on (see that layout's own header comment and
// tests/integration/f003-portal-shell.test.ts, which already covers this
// guard end-to-end against a live Supabase project for AS-007).
//
// This file unit-tests the shared guard itself: `p/[projectId]/layout.tsx`
// calls `notFound()` whenever the requested project isn't in
// `getPortalProjects`' result, and `getPortalProjects` (lib/queries/
// portal.ts) is the single choke point where BOTH failure modes this
// feature is responsible for collapse to the same absence:
//
//   AS-095 (portal disabled): `getPortalProjects` filters on
//   `.eq("portal_enabled", true)` -- a portal-disabled project is never
//   in the list, `.find(id)` returns undefined, the layout 404s.
//
//   AS-096 (non-member): `getPortalProjects` selects through RLS as the
//   signed-in user -- a project this client isn't a member of never
//   comes back as a row at all (RLS hides it, not a business-logic
//   filter), so `.find(id)` again returns undefined and the layout 404s.
//
// Because the Architecture page renders as a child of this layout with no
// route param of its own to re-check, proving the layout 404s in both
// scenarios is exactly what "the Architecture route guards against
// portal-disabled and non-member access" reduces to.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { notFound, redirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ notFound, redirect }));

let portalProjects: Array<{ id: string; name: string; billingModel: string | null; targetLaunchDate: string | null; launchConfidence: string | null }>;
let workspaceRow: { id: string; name: string; slug: string; logo_url: string | null } | null;
let currentUser: { id: string; email: string } | null;

vi.mock("@/lib/queries/portal", () => ({
  getPortalProjects: vi.fn(async () => portalProjects),
  getPortalBadgeCounts: vi.fn(async () => ({ approvalsAwaiting: 0, yourListOpen: 0 })),
  getPortalCurrentUserProfile: vi.fn(async () => null),
}));

// Mission 20260914-portal-simplify, F008: the layout now sources the
// sidebar's "For you" badge from `getWaitingOnYouCount` (F005) instead of
// `getPortalBadgeCounts` -- mocked here the same way, so this guard test
// doesn't need the narrow Supabase client mock below to support the real
// approvals/deliverables query chains it never exercised before.
vi.mock("@/lib/portal/waiting-on-you-count", () => ({
  getWaitingOnYouCount: vi.fn(async () => ({
    ok: true,
    data: { decisions: 0, materials: 0, total: 0, overdue: 0 },
  })),
}));

vi.mock("@/lib/queries/project-site", () => ({
  getClientVisiblePortalLinks: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: workspaceRow, error: null })),
        })),
      })),
    })),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: currentUser } })),
    },
  })),
}));

import PortalProjectLayout from "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout";

describe("F039 / AS-095: portal Architecture route 404s when portal is disabled", () => {
  beforeEach(() => {
    notFound.mockClear();
    redirect.mockClear();
    workspaceRow = { id: "ws-1", name: "Acme", slug: "acme", logo_url: null };
    currentUser = { id: "user-1", email: "client@example.com" };
  });

  it("calls notFound() when the requested project has portal_enabled = false", async () => {
    // getPortalProjects already filters out portal-disabled projects
    // (lib/queries/portal.ts .eq("portal_enabled", true)) -- from this
    // layout's point of view a disabled project simply never appears.
    portalProjects = [];

    await expect(
      PortalProjectLayout({
        children: null,
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "disabled-project" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders normally (no notFound) when the project is portal-enabled", async () => {
    portalProjects = [
      {
        id: "enabled-project",
        name: "Enabled Project",
        billingModel: null,
        targetLaunchDate: null,
        launchConfidence: null,
      },
    ];

    await expect(
      PortalProjectLayout({
        children: null,
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "enabled-project" }),
      }),
    ).resolves.toBeTruthy();

    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("F039 / AS-096: portal Architecture route 404s for a non-member client", () => {
  beforeEach(() => {
    notFound.mockClear();
    redirect.mockClear();
    workspaceRow = { id: "ws-1", name: "Acme", slug: "acme", logo_url: null };
    currentUser = { id: "user-2", email: "not-a-member@example.com" };
  });

  it("calls notFound() when the signed-in user has no RLS-visible row for this project", async () => {
    // RLS hides projects the signed-in client isn't a member of, so
    // getPortalProjects simply never returns that row for this session --
    // indistinguishable at this layer from the portal-disabled case,
    // which is exactly why one guard covers both AS-095 and AS-096.
    portalProjects = [];

    await expect(
      PortalProjectLayout({
        children: null,
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "someone-elses-project" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });
});

describe("F039: layout re-checks for a signed-out session even under the outer layout's guarantee", () => {
  beforeEach(() => {
    notFound.mockClear();
    redirect.mockClear();
    workspaceRow = { id: "ws-1", name: "Acme", slug: "acme", logo_url: null };
    portalProjects = [];
  });

  it("redirects to /sign-in when there is no authenticated user", async () => {
    currentUser = null;

    await expect(
      PortalProjectLayout({
        children: null,
        params: Promise.resolve({ workspaceSlug: "acme", projectId: "any-project" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });
});
