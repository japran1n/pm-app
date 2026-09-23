// @vitest-environment jsdom
//
// F014 / PL-012: the earlier version of this regression test mocked
// `getProjectTeamPreview` itself as `async () => new Map()` — a mock that
// can never reject, so it could never actually exercise the projects
// page's `.catch()` fail-open path. This test instead uses the REAL
// `getProjectTeamPreview` (lib/queries/projects.ts, unmocked) and makes
// the Supabase client it calls throw, so the only way this test can pass
// is if `ProjectsGridSection`'s `.catch()` around `getProjectTeamPreview`
// actually fires. Definition of done: reverting that `.catch()` (making
// the page call `getProjectTeamPreview(...)` directly, unguarded) must
// make this test fail.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

// Only these are mocked -- `getProjectTeamPreview` is imported for real
// (below) from `@/lib/queries/projects`, so the exported module must be
// partially mocked rather than fully replaced.
vi.mock("@/lib/queries/projects", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/projects")>(
    "@/lib/queries/projects",
  );
  return {
    ...actual,
    getWorkspaceProjects: (...args: unknown[]) => getWorkspaceProjectsMock(...args),
    getFavoriteProjectIds: (...args: unknown[]) => getFavoriteProjectIdsMock(...args),
    getProjectHealthInputs: (...args: unknown[]) => getProjectHealthInputsMock(...args),
    // getProjectTeamPreview: intentionally NOT overridden -- the real
    // implementation runs and hits the (mocked, throwing) Supabase client
    // below.
  };
});

vi.mock("@/lib/queries/templates", () => ({
  getWorkspaceProjectTemplateOptions: vi.fn(async () => []),
}));

const loggerErrorMock = vi.fn();
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() },
}));

// The real `getProjectTeamPreview` calls `createClient()` (server-only
// Supabase client) and then `.from("task_assignees")...`. Making that
// client throw is what actually causes `getProjectTeamPreview` to reject,
// which is the real condition PL-012's `.catch()` must fail open against.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("supabase client unavailable");
  }),
}));

describe("ProjectsPage team-preview resilience (F014 / PL-012)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every card with an empty team (no avatars) instead of throwing when getProjectTeamPreview rejects", async () => {
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
    getProjectHealthInputsMock.mockResolvedValue(new Map());

    const element = await ProjectsGridSection({
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      canArchive: false,
      canSaveTemplate: true,
    });

    const html = renderToStaticMarkup(element);

    // The page must still render the real project card (never throw, never
    // redirect) ...
    expect(html).toContain("Real Project");
    // ... and the card's team slot must be present but empty -- no avatar
    // markup rendered for it, because the team preview map fell back to
    // empty rather than the page crashing.
    expect(html).toContain('data-testid="card-team"');
    const teamSlotMatch = html.match(/data-testid="card-team">([\s\S]*?)<\/div>/);
    expect(teamSlotMatch).not.toBeNull();
    expect(teamSlotMatch?.[1]).toBe("");

    // The failure was logged, not swallowed silently.
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
