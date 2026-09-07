// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Regression test for a real bug report: `/w/[workspaceSlug]/projects`
// (F027) must NEVER redirect to `/sign-in` or throw when the "Project
// health badge" feature's own batched query
// (`getProjectHealthInputs`, lib/queries/projects.ts) fails. Health is a
// best-effort, nice-to-have overlay -- a failure there must degrade to
// "no badge" for the affected project, never take down the whole list
// (and, critically, must never be misinterpreted anywhere along the way
// as "not signed in").
//
// `ProjectsGridSection` (the exported Suspense-boundary child that owns
// this fetch) is exercised directly here rather than through a full HTTP
// request, mirroring this repo's existing pattern of unit-testing a
// page's exported pieces (e.g. route-error-boundaries.test.tsx importing
// error.tsx directly) rather than spinning up a server.

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

vi.mock("@/lib/queries/projects", () => ({
  getWorkspaceProjects: (...args: unknown[]) => getWorkspaceProjectsMock(...args),
  getFavoriteProjectIds: (...args: unknown[]) => getFavoriteProjectIdsMock(...args),
  getProjectHealthInputs: (...args: unknown[]) => getProjectHealthInputsMock(...args),
}));

vi.mock("@/lib/queries/templates", () => ({
  getWorkspaceProjectTemplateOptions: vi.fn(async () => []),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe("ProjectsPage health-badge resilience (F027 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still renders the project list, without redirecting to /sign-in, when getProjectHealthInputs rejects", async () => {
    const { ProjectsGridSection } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const projects = [
      {
        id: "proj-1",
        name: "Real Project",
        description: "A real project",
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        key: "PM",
        icon: null,
        sidebarPosition: null,
        openTaskCount: 2,
      },
    ];

    getWorkspaceProjectsMock.mockResolvedValue(projects);
    getFavoriteProjectIdsMock.mockResolvedValue(new Set());
    // Simulate the exact failure mode from the bug report: the health
    // inputs query blows up (e.g. a bad column reference or transient DB
    // error).
    getProjectHealthInputsMock.mockRejectedValue(
      new Error("column tasks.does_not_exist does not exist"),
    );

    const element = await ProjectsGridSection({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      canArchive: false,
      canSaveTemplate: true,
    });

    // Must not have redirected to sign-in (or anywhere else) just because
    // an optional, best-effort panel's query failed.
    expect(redirectMock).not.toHaveBeenCalled();

    // The returned element tree must still represent the real project
    // list, not an error/empty state -- proving the page rendered past
    // the health-inputs failure rather than aborting.
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Real Project");
  });

  it("still renders the project list when getFavoriteProjectIds itself throws (not just returns an error)", async () => {
    const { ProjectsGridSection } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/projects/page"
    );

    const projects = [
      {
        id: "proj-2",
        name: "Another Project",
        description: null,
        startDate: null,
        endDate: null,
        createdAt: new Date().toISOString(),
        key: "PM2",
        icon: null,
        sidebarPosition: null,
        openTaskCount: 0,
      },
    ];

    getWorkspaceProjectsMock.mockResolvedValue(projects);
    getFavoriteProjectIdsMock.mockRejectedValue(new Error("cookies() blew up mid-stream"));
    getProjectHealthInputsMock.mockResolvedValue(new Map());

    const element = await ProjectsGridSection({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      canArchive: false,
      canSaveTemplate: true,
    });

    expect(redirectMock).not.toHaveBeenCalled();

    const html = renderToStaticMarkup(element);
    expect(html).toContain("Another Project");
  });
});
