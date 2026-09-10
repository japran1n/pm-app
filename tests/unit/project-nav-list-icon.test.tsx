// @vitest-environment jsdom
//
// UI polish: the sidebar project list row no longer shows a project's icon,
// colour dot, or key abbreviation -- only [grip] [name] [star]. This
// supersedes the earlier "Feature request 'Project ikonica/emoji'" test
// (icon/key display), which is intentionally removed.
import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/p1/board",
}));

vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: () => null,
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectNavList row identifier (UI polish: no icon/dot/key)", () => {
  it("never renders the project's icon even when set", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Rocket Project", key: "RK", icon: "🚀" }],
      }),
    );

    expect(screen.queryByText("🚀")).not.toBeInTheDocument();
    expect(screen.queryByText("RK")).not.toBeInTheDocument();
    expect(screen.getByText("Rocket Project")).toBeInTheDocument();
  });

  it("never renders the project's key abbreviation when no icon is set", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Plain Project", key: "PL", icon: null }],
      }),
    );

    expect(screen.queryByText("PL")).not.toBeInTheDocument();
    expect(screen.getByText("Plain Project")).toBeInTheDocument();
  });
});
