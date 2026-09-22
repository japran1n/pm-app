// F035 (FU-22, SB-006 / SB-009): when the layout's memberships query ERRORS
// (logged, not thrown), the sidebar's `isGuest` and the provider's role must
// fail closed together. Calls the real WorkspaceLayout and inspects the
// props it hands to the (stubbed) AppSidebar / MembershipProvider.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((u: string) => { throw new Error(`NEXT_REDIRECT:${u}`); }),
  permanentRedirect: vi.fn(() => { throw new Error("NEXT_PERMANENT_REDIRECT"); }),
}));

let membershipsResult: { data: unknown; error: unknown };

const ws = { id: "w1", name: "Acme", slug: "acme", logo_url: null };

function table(name: string) {
  const result =
    name === "workspace_members"
      ? membershipsResult
      : name === "profiles"
        ? { data: { display_name: "T", avatar_url: null }, error: null }
        : { data: [], error: null };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "is"]) chain[k] = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => result);
  // count query (client members) and project_members are awaited directly
  chain.then = (res: (v: unknown) => unknown) =>
    Promise.resolve(name === "workspace_members" ? { ...result, count: 0 } : { ...result, count: 0 }).then(res);
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
const AppSidebar = stub("AppSidebar");
const MembershipProvider = stub("MembershipProvider");
vi.mock("@/components/nav/app-sidebar", () => ({ AppSidebar }));
vi.mock("@/components/auth/membership-provider", () => ({ MembershipProvider }));
for (const [path, names] of Object.entries({
  "@/components/nav/app-header": ["AppHeader"],
  "@/components/nav/workspace-presence-provider": ["WorkspacePresenceProvider"],
  "@/components/nav/figures/tour-figure": ["TourFigure"],
  "@/components/nav/figures/approvals-badge-figure": ["ApprovalsBadgeFigure"],
  "@/components/nav/figures/requests-badge-figure": ["RequestsBadgeFigure"],
  "@/components/nav/figures/chat-unread-badge-figure": ["ChatUnreadBadgeFigure"],
  "@/components/nav/figures/workspace-switcher-figure": ["WorkspaceSwitcherFigure"],
  "@/components/nav/figures/skeletons": ["NavBadgeSkeleton", "WorkspaceSwitcherSkeleton"],
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

// Collect every element in the returned tree whose type is `type`.
function find(node: unknown, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => find(n, type, out)); return out; }
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === type) out.push(el);
  find(el.props?.children, type, out);
  return out;
}

async function render() {
  const { default: WorkspaceLayout } = await import("@/app/(workspace)/w/[workspaceSlug]/layout");
  const tree = await WorkspaceLayout({ children: null, params: Promise.resolve({ workspaceSlug: "acme" }) });
  const sidebar = find(tree, AppSidebar)[0].props as { isGuest: boolean; canManageWorkspace: boolean };
  const provider = (tree as ReactElement<{ role: string }>).props;
  return { sidebar, role: provider.role };
}

describe("F035 FU-22 / SB-006, SB-009: layout fails closed on memberships error", () => {
  beforeEach(() => { vi.resetModules(); });

  it("test_SB_006_memberships_query_error_makes_isGuest_true_and_role_guest_together", async () => {
    membershipsResult = { data: null, error: { message: "boom" } };
    const { sidebar, role } = await render();
    expect(role).toBe("guest");
    expect(sidebar.isGuest).toBe(true);
    expect(sidebar.canManageWorkspace).toBe(false);
  });

  it("test_SB_006_memberships_missing_row_for_active_workspace_fails_closed", async () => {
    membershipsResult = { data: [{ workspace_id: "other", role: "owner" }], error: null };
    const { sidebar, role } = await render();
    expect(role).toBe("guest");
    expect(sidebar.isGuest).toBe(true);
  });

  it("test_SB_009_healthy_admin_membership_is_not_guest", async () => {
    membershipsResult = { data: [{ workspace_id: "w1", role: "admin" }], error: null };
    const { sidebar, role } = await render();
    expect(role).toBe("admin");
    expect(sidebar.isGuest).toBe(false);
    expect(sidebar.canManageWorkspace).toBe(true);
  });

  it("test_SB_006_real_guest_membership_is_guest", async () => {
    membershipsResult = { data: [{ workspace_id: "w1", role: "guest" }], error: null };
    const { sidebar, role } = await render();
    expect(role).toBe("guest");
    expect(sidebar.isGuest).toBe(true);
  });
});
