// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// F013 (PL-043, PL-044, PL-046): the list-view table for the Projects
// page — same feature parity as the grid (favourite star, actions menu,
// search, empty state, load-error state), rendered as a `<table>` with
// Name+phase / Due / Progress / Team / Time left / Health / actions
// columns, DS edge-cell spacing (via components/ui/table), and the open
// task count surfaced per row.

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
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

function makeProject(id: string, name: string, openTaskCount: number | null = 3) {
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
    openTaskCount,
  };
}

async function renderListView() {
  const { ProjectsGridSection } = await import(
    "@/app/(workspace)/w/[workspaceSlug]/projects/page"
  );
  const {
    ProjectsSearchProvider,
    ProjectsToolbarWithSearch,
  } = await import("@/components/projects/projects-search-context");

  const element = await ProjectsGridSection({
    workspaceId: "ws-1",
    workspaceSlug: "acme",
    canArchive: false,
    canSaveTemplate: true,
    isListView: true,
  });

  render(
    <ProjectsSearchProvider>
      <ProjectsToolbarWithSearch workspaceId="ws-1" templateOptions={[]} />
      {element}
    </ProjectsSearchProvider>,
  );
}

describe("F013: Projects list view table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceContextMock.mockResolvedValue({
      user: { id: "user-1" },
      workspace: { id: "ws-1", name: "Acme" },
      role: "member",
    });
    getFavoriteProjectIdsMock.mockResolvedValue(new Set());
    getProjectHealthInputsMock.mockResolvedValue(new Map());
  });

  afterEach(() => {
    cleanup();
  });

  it("test_PL_043_renders_a_table_with_required_columns_and_row_link", async () => {
    getWorkspaceProjectsMock.mockResolvedValue([makeProject("p1", "Marketing Site")]);

    await renderListView();

    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();

    // Header columns per PL-043.
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Due" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Progress" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Time left" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Health" })).toBeInTheDocument();

    // Row links to the project.
    const link = screen.getByRole("link", { name: /Marketing Site/ });
    expect(link).toHaveAttribute("href", "/w/acme/projects/p1/list");

    // Open task count shown.
    expect(
      screen.getAllByText(
        (_, node) => node?.textContent === "3 open tasks",
      ).length,
    ).toBeGreaterThan(0);

    // DS edge spacing present on header/cell classes.
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    expect(nameHeader.className).toContain("first:pl-6");
    expect(nameHeader.className).toContain("lg:first:pl-8");
  });

  it("test_PL_044_list_view_keeps_favourite_star_and_actions_menu_per_row", async () => {
    getWorkspaceProjectsMock.mockResolvedValue([makeProject("p1", "Marketing Site")]);

    await renderListView();

    expect(
      screen.getByRole("button", { name: /marketing site to favourites/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More actions for Marketing Site" }),
    ).toBeInTheDocument();
  });

  it("test_PL_044_list_view_respects_the_search_filter", async () => {
    getWorkspaceProjectsMock.mockResolvedValue([
      makeProject("p1", "Marketing Site"),
      makeProject("p2", "Mobile App"),
    ]);

    await renderListView();

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.getByText("Mobile App")).toBeInTheDocument();

    const input = screen.getByRole("searchbox", { name: /search projects/i });
    fireEvent.change(input, { target: { value: "marketing" } });

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.queryByText("Mobile App")).not.toBeInTheDocument();
  });

  it("test_PL_046_empty_state_when_no_projects_exist_in_list_view", async () => {
    getWorkspaceProjectsMock.mockResolvedValue([]);

    await renderListView();

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("test_PL_046_load_error_state_shown_instead_of_table_when_project_query_fails", async () => {
    getWorkspaceProjectsMock.mockRejectedValue(new Error("boom"));

    const { ProjectsGridSection } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const element = await ProjectsGridSection({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      canArchive: false,
      canSaveTemplate: true,
      isListView: true,
    });

    render(element);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong loading projects. Please try again.",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
