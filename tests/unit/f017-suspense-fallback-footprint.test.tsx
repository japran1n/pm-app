import { Suspense } from "react";
import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { NavBadgeSkeleton } from "@/components/nav/figures/skeletons";

// F017 (AS-017, AS-020): the F016 figures' `<Suspense fallback={null}>`
// wrappers are replaced with skeletons that reserve each figure's
// resolved-with-a-value footprint, so nothing shifts once the async figure
// settles. This suite asserts (1) each skeleton renders a non-empty, sized
// placeholder element, and (2) rendering the REAL workspace layout tree
// (F059/FU-M4-12: no more readFileSync + regex source-counting) shows every
// badge/switcher figure wrapped in its skeleton fallback, and only the
// flow-less tour/banner/realtime figures keep `fallback={null}`.

describe("AS-017/AS-020: Suspense fallbacks hold each figure's exact footprint", () => {
  it("NavBadgeSkeleton renders a sized, non-empty placeholder (the badge-figures' occupied state)", () => {
    const html = renderToStaticMarkup(createElement(NavBadgeSkeleton));
    expect(html).toMatch(/h-4/);
    expect(html).toMatch(/w-5/);
    expect(html).toMatch(/animate-pulse/);
    expect(html).toMatch(/bg-muted/);
  });

  // F014 (SB-053, SB-054, SB-055): NotificationBellSkeleton and the bell
  // itself (and its Suspense fallback) are gone from the layout entirely
  // (F059 deleted notification-bell.tsx/-figure.tsx outright), so there is
  // no skeleton left to assert on here.

  // WorkspaceSwitcherSkeleton footprint is asserted by real-Chromium
  // measurement in f036-switcher-skeleton-footprint.test.ts (F036).
});

// ---------------------------------------------------------------------------
// Real-render regression test against the layout's actual Suspense tree.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); }),
  permanentRedirect: vi.fn(() => { throw new Error("NEXT_PERMANENT_REDIRECT"); }),
}));

const ws = { id: "w1", name: "Acme", slug: "acme", logo_url: null };

function table(name: string) {
  const result =
    name === "workspace_members"
      ? { data: [{ workspace_id: "w1", role: "admin" }], error: null }
      : name === "profiles"
        ? { data: { display_name: "T", avatar_url: null }, error: null }
        : { data: [], error: null };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "is"]) chain[k] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ ...result, count: 0 }).then(res);
  return chain;
}

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({
    supabase: { from: vi.fn((n: string) => table(n)) },
    user: { id: "u1", email: "t@example.com" },
  })),
}));
vi.mock("@/lib/queries/workspaces", () => ({ getWorkspaceBySlug: vi.fn(async () => ws) }));
vi.mock("@/lib/queries/projects", () => ({
  getWorkspaceProjects: vi.fn(async () => [{ id: "p1", name: "Apollo", key: "APL", icon: null }]),
}));
vi.mock("@/components/nav/figures/favorite-project-ids-figure", () => ({
  getFavoriteProjectIds: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/lib/calendar/client-presentation", () => ({ getUpcomingClientPresentations: vi.fn(async () => []) }));
vi.mock("@/lib/observability/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const stub = (name: string) => {
  const C = () => null;
  Object.defineProperty(C, "name", { value: name });
  return C;
};
const NotificationsRealtimeFigure = stub("NotificationsRealtimeFigure");
const InboxBadgeFigure = stub("InboxBadgeFigure");
const TourFigure = stub("TourFigure");
const ApprovalsBadgeFigure = stub("ApprovalsBadgeFigure");
const RequestsBadgeFigure = stub("RequestsBadgeFigure");
const ChatUnreadBadgeFigure = stub("ChatUnreadBadgeFigure");
const WorkspaceSwitcherFigure = stub("WorkspaceSwitcherFigure");

vi.mock("@/components/nav/figures/notifications-realtime-figure", () => ({ NotificationsRealtimeFigure }));
vi.mock("@/components/nav/figures/inbox-badge-figure", () => ({ InboxBadgeFigure }));
vi.mock("@/components/nav/figures/tour-figure", () => ({ TourFigure }));
vi.mock("@/components/nav/figures/approvals-badge-figure", () => ({ ApprovalsBadgeFigure }));
vi.mock("@/components/nav/figures/requests-badge-figure", () => ({ RequestsBadgeFigure }));
vi.mock("@/components/nav/figures/chat-unread-badge-figure", () => ({ ChatUnreadBadgeFigure }));
vi.mock("@/components/nav/figures/workspace-switcher-figure", () => ({ WorkspaceSwitcherFigure }));

for (const [path, names] of Object.entries({
  "@/components/nav/app-sidebar": ["AppSidebar"],
  "@/components/auth/membership-provider": ["MembershipProvider"],
  "@/components/nav/app-header": ["AppHeader"],
  "@/components/nav/workspace-presence-provider": ["WorkspacePresenceProvider"],
  "@/components/command/command-palette": ["CommandPalette"],
  "@/components/command/project-switcher": ["ProjectSwitcher"],
  "@/components/command/shortcut-provider": ["ShortcutProvider"],
  "@/components/command/shortcut-help": ["ShortcutHelpDialog"],
  "@/components/my-tasks/quick-note-modal": ["QuickNoteModal"],
  "@/components/nav/breadcrumb-context": ["BreadcrumbProvider"],
  "@/components/calendar/client-presentation-banner": ["ClientPresentationBanner"],
  "@/components/nav/workspace-main": ["WorkspaceMain"],
})) {
  vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, stub(n)])));
}

// Collect every Suspense element in the returned tree, along with its
// fallback. Figure Suspense boundaries are passed as ordinary element props
// (e.g. AppSidebar's `inboxBadge` slot), not only as `children`, so every
// prop value is walked, not just `children`.
function findSuspenseFallbacks(node: unknown, out: unknown[] = [], seen = new Set<unknown>()): unknown[] {
  if (!node || typeof node !== "object") return out;
  if (seen.has(node)) return out;
  if (Array.isArray(node)) { node.forEach((n) => findSuspenseFallbacks(n, out, seen)); return out; }
  seen.add(node);
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === Suspense) out.push((el.props as { fallback?: unknown }).fallback);
  if (el.props && typeof el.props === "object") {
    for (const value of Object.values(el.props)) {
      findSuspenseFallbacks(value, out, seen);
    }
  }
  return out;
}

describe("F059/FU-M4-12: the real workspace layout tree's Suspense fallbacks", () => {
  beforeEach(() => { vi.resetModules(); });

  it("only the flow-less tour/banner/realtime figures keep fallback={null}; every badge/switcher figure reserves a skeleton", async () => {
    const { default: WorkspaceLayout } = await import("@/app/(workspace)/w/[workspaceSlug]/layout");
    // Re-import the skeleton components AFTER vi.resetModules() so their
    // identity matches whatever fresh module instance the layout itself
    // resolved -- not the module-graph snapshot captured by this file's
    // top-level import.
    const { NavBadgeSkeleton: FreshNavBadgeSkeleton, WorkspaceSwitcherSkeleton: FreshWorkspaceSwitcherSkeleton } =
      await import("@/components/nav/figures/skeletons");
    const tree = await WorkspaceLayout({
      children: null,
      params: Promise.resolve({ workspaceSlug: "acme" }),
    });
    const fallbacks = findSuspenseFallbacks(tree);

    const nullFallbacks = fallbacks.filter((f) => f === null);
    // TourFigure, ClientPresentationBannerFigure, NotificationsRealtimeFigure.
    expect(nullFallbacks).toHaveLength(3);

    const isSkeletonElement = (f: unknown, type: unknown) =>
      typeof f === "object" && f !== null && (f as ReactElement).type === type;

    const navBadgeSkeletons = fallbacks.filter((f) => isSkeletonElement(f, FreshNavBadgeSkeleton));
    // Inbox, Approvals, Requests, ChatUnread badges.
    expect(navBadgeSkeletons).toHaveLength(4);

    const switcherSkeletons = fallbacks.filter((f) => isSkeletonElement(f, FreshWorkspaceSwitcherSkeleton));
    expect(switcherSkeletons).toHaveLength(1);

    // No fallback is left over -- every Suspense boundary is accounted for
    // by one of the three buckets above.
    expect(fallbacks).toHaveLength(nullFallbacks.length + navBadgeSkeletons.length + switcherSkeletons.length);
  });
});
