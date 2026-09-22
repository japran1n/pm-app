// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// F012 (SB-045, SB-046): `/w/<slug>/projects?filter=archived` shows the
// archived-projects view (folded in from the old standalone /archive
// page); the default view excludes archived projects. The old /archive
// route now server-redirects to the new canonical URL.

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

describe("F012 SB-045: Projects page archived filter", () => {
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

  // The page's data-fetching sections stream in via <Suspense>, which
  // `renderToStaticMarkup` doesn't wait on (same reason
  // projects-page-health-resilience.test.tsx exercises `ProjectsGridSection`
  // directly instead of the full page) — so the synchronous, non-Suspense
  // part of the page (header copy + filter tabs, both driven by the same
  // `isArchivedView` value that picks which section to stream in) is what's
  // asserted at the page level, and the two data sections themselves are
  // exercised directly below.

  it("SB-045: ?filter=archived renders the Archived view (header copy + active tab)", async () => {
    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ filter: "archived" }),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain(
      "Archiving hides a project from the active list without deleting its data.",
    );
    // "New Project" isn't offered on the archived view.
    expect(html).not.toContain("New Project");
  });

  it("SB-045: default view (no filter) renders the active-projects header, not the archived one", async () => {
    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("All projects in Acme.");
    expect(html).not.toContain(
      "Archiving hides a project from the active list without deleting its data.",
    );
  });

  it("SB-045: a guest requesting ?filter=archived still gets the active-projects header, never the archived one", async () => {
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

  it("SB-045: the archived section fetches and renders only archived projects via getArchivedWorkspaceProjects", async () => {
    const { ArchivedProjectsSection } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    getArchivedWorkspaceProjectsMock.mockResolvedValue([
      {
        id: "proj-archived-1",
        name: "Archived Project One",
        description: "Old work",
        archivedAt: new Date().toISOString(),
        archivedByName: "Jane Doe",
        taskCount: 3,
      },
    ]);

    const element = await ArchivedProjectsSection({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      canRestore: true,
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("Archived Project One");
    expect(getArchivedWorkspaceProjectsMock).toHaveBeenCalledWith("ws-1");
  });

  it("SB-045: the default active section (ProjectsGridSection) never calls getArchivedWorkspaceProjects", async () => {
    const { ProjectsGridSection } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    getWorkspaceProjectsMock.mockResolvedValue([
      {
        id: "proj-active-2",
        name: "Only Active Project",
        description: null,
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        key: "PM",
        icon: null,
        sidebarPosition: null,
        openTaskCount: 0,
      },
    ]);

    const element = await ProjectsGridSection({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      canArchive: false,
      canSaveTemplate: true,
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("Only Active Project");
    expect(getArchivedWorkspaceProjectsMock).not.toHaveBeenCalled();
  });
});

describe("F012 SB-046: /archive redirects to the canonical projects URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SB-046: requesting /w/<slug>/archive redirects to /w/<slug>/projects?filter=archived", async () => {
    const { default: ArchivePage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/archive/page"
    );

    await expect(
      ArchivePage({ params: Promise.resolve({ workspaceSlug: "acme" }) }),
    ).rejects.toThrow("REDIRECT:/w/acme/projects?filter=archived");

    expect(redirectMock).toHaveBeenCalledWith(
      "/w/acme/projects?filter=archived",
    );
  });
});
