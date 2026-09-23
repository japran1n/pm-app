// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// F010 (PL-040, PL-045): the Projects page toolbar row (search input, view
// toggle, New Project) and the pre-existing Active/Archived tabs + guest
// gating, which this feature must leave untouched.

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/w/acme/projects",
  useSearchParams: () => new URLSearchParams(),
}));

const getWorkspaceProjectsMock = vi.fn();
const getFavoriteProjectIdsMock = vi.fn();
const getProjectHealthInputsMock = vi.fn();
const getArchivedWorkspaceProjectsMock = vi.fn();

vi.mock("@/lib/queries/projects", () => ({
  getWorkspaceProjects: (...args: unknown[]) => getWorkspaceProjectsMock(...args),
  getFavoriteProjectIds: (...args: unknown[]) => getFavoriteProjectIdsMock(...args),
  getProjectHealthInputs: (...args: unknown[]) => getProjectHealthInputsMock(...args),
  getProjectTeamPreview: async () => new Map(),
  getArchivedWorkspaceProjects: (...args: unknown[]) =>
    getArchivedWorkspaceProjectsMock(...args),
}));

vi.mock("@/lib/queries/templates", () => ({
  getWorkspaceProjectTemplateOptions: vi.fn(async () => []),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const getWorkspaceContextMock = vi.fn();
vi.mock("@/lib/queries/workspaces", () => ({
  getWorkspaceContext: (...args: unknown[]) => getWorkspaceContextMock(...args),
}));

describe("F010 PL-040: Projects toolbar layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceContextMock.mockResolvedValue({
      user: { id: "user-1" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "member",
    });
    getWorkspaceProjectsMock.mockResolvedValue([]);
    getFavoriteProjectIdsMock.mockResolvedValue(new Set());
    getProjectHealthInputsMock.mockResolvedValue(new Map());
  });

  it("PL-040: the active view's header holds a search input, a view radiogroup and New Project", async () => {
    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="View"');
    expect(html).toContain("New Project");
  });

  it("PL-040: the toolbar row stacks on narrow viewports (flex-col) and lays out horizontally at sm and up (sm:flex-row)", async () => {
    const { ProjectsToolbar } = await import(
      "@/components/projects/projects-toolbar"
    );

    const html = renderToStaticMarkup(
      ProjectsToolbar({ workspaceId: "ws-1", templateOptions: [] }),
    );

    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
    // The search input grows to fill the row once there is room.
    expect(html).toContain("sm:flex-1");
  });

  it("PL-040: the archived view (no New Project offered) does not render the toolbar's search input or view toggle", async () => {
    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ filter: "archived" }),
    });

    const html = renderToStaticMarkup(element);
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain('aria-label="View"');
    expect(html).not.toContain("New Project");
  });
});

describe("F010 PL-045: Active/Archived tabs and guest gating stay unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceProjectsMock.mockResolvedValue([]);
    getFavoriteProjectIdsMock.mockResolvedValue(new Set());
    getProjectHealthInputsMock.mockResolvedValue(new Map());
  });

  it("PL-045: a member sees both the Active and Archived tab links", async () => {
    getWorkspaceContextMock.mockResolvedValue({
      user: { id: "user-1" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "member",
    });

    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain(">Active<");
    expect(html).toContain(">Archived<");
    expect(html).toContain(`/w/acme/projects?filter=archived`);
  });

  it("PL-045: a guest sees no Archived tab at all", async () => {
    getWorkspaceContextMock.mockResolvedValue({
      user: { id: "user-guest" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "guest",
    });

    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(element);
    expect(html).not.toContain(">Archived<");
    expect(html).not.toContain("filter=archived");
  });

  it("PL-045: a guest requesting ?filter=archived still falls back to the active view, not the archived one", async () => {
    getWorkspaceContextMock.mockResolvedValue({
      user: { id: "user-guest" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "guest",
    });

    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ filter: "archived" }),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("All projects in Acme.");
    expect(html).not.toContain(
      "Archiving hides a project from the active list without deleting its data.",
    );
  });
});
