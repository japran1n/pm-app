// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// F011 (PL-041): client-side search on the Projects page — filters the
// already-loaded project list by name OR current phase name,
// case-insensitively, and never appears on the archived view.

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

function makeProject(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    startDate: null,
    endDate: null,
    targetLaunchDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    key: null,
    icon: null,
    sidebarPosition: null,
    openTaskCount: 0,
  };
}

// Renders the real integration: `ProjectsSearchProvider` (the shared
// client state) wrapping the real `ProjectsToolbarWithSearch` (header)
// and the ALREADY-RESOLVED grid section JSX (the plain react-dom test
// renderer can't await an async Server Component embedded live inside a
// `<Suspense>` tree — that's an RSC-runtime feature, not something
// `@testing-library/react`'s client render supports — so the async
// `ProjectsGridSection` export is awaited here directly first, same
// convention as tests/unit/projects-page-health-resilience.test.tsx).
async function renderActiveProjectsView() {
  const { ProjectsGridSection } = await import(
    "@/app/(workspace)/w/[workspaceSlug]/projects/page"
  );
  const {
    ProjectsSearchProvider,
    ProjectsToolbarWithSearch,
  } = await import("@/components/projects/projects-search-context");

  const gridElement = await ProjectsGridSection({
    workspaceId: "ws-1",
    workspaceSlug: "acme",
    canArchive: false,
    canSaveTemplate: true,
  });

  render(
    <ProjectsSearchProvider>
      <ProjectsToolbarWithSearch workspaceId="ws-1" templateOptions={[]} />
      {gridElement}
    </ProjectsSearchProvider>,
  );
}

describe("F011 PL-041: Projects page client-side search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceContextMock.mockResolvedValue({
      user: { id: "user-1" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "member",
    });
    getFavoriteProjectIdsMock.mockResolvedValue(new Set());
  });

  afterEach(() => {
    cleanup();
  });

  it("PL-041: typing a query filters the grid to projects whose name matches, case-insensitively", async () => {
    getWorkspaceProjectsMock.mockResolvedValue([
      makeProject("p1", "Marketing Site"),
      makeProject("p2", "Mobile App"),
    ]);
    getProjectHealthInputsMock.mockResolvedValue(new Map());

    await renderActiveProjectsView();

    // Both cards present before searching.
    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.getByText("Mobile App")).toBeInTheDocument();

    const input = screen.getByRole("searchbox", { name: /search projects/i });
    fireEvent.change(input, { target: { value: "marketing" } });

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.queryByText("Mobile App")).not.toBeInTheDocument();
  });

  it("PL-041: a query matching only a project's current phase name still surfaces that project", async () => {
    getWorkspaceProjectsMock.mockResolvedValue([
      makeProject("p1", "Marketing Site"),
      makeProject("p2", "Mobile App"),
    ]);
    getProjectHealthInputsMock.mockResolvedValue(
      new Map([
        [
          "p2",
          {
            overdueTaskCount: 0,
            totalTaskCount: 0,
            doneTaskCount: 0,
            currentPhase: {
              name: "Beta Rollout",
              state: "active",
              plannedStart: null,
              plannedEnd: null,
            },
          },
        ],
      ]),
    );

    await renderActiveProjectsView();

    const input = screen.getByRole("searchbox", { name: /search projects/i });
    fireEvent.change(input, { target: { value: "BETA" } });

    expect(screen.getByText("Mobile App")).toBeInTheDocument();
    expect(screen.queryByText("Marketing Site")).not.toBeInTheDocument();
  });

  it('PL-041: a query matching nothing shows \'No projects match "<query>"\'', async () => {
    getWorkspaceProjectsMock.mockResolvedValue([makeProject("p1", "Marketing Site")]);
    getProjectHealthInputsMock.mockResolvedValue(new Map());

    await renderActiveProjectsView();

    const input = screen.getByRole("searchbox", { name: /search projects/i });
    fireEvent.change(input, { target: { value: "zzz-no-match" } });

    expect(
      screen.getByText("No projects match “zzz-no-match”"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Marketing Site")).not.toBeInTheDocument();
  });

  it("PL-041: the archived view does not render a search input", async () => {
    getArchivedWorkspaceProjectsMock.mockResolvedValue([]);

    const { default: ProjectsPage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ filter: "archived" }),
    });

    render(element);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
