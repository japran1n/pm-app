// @vitest-environment jsdom
//
// Feature request "Project ikonica/emoji": the sidebar project list shows
// a project's icon when set, falling back to the pre-existing key/folder
// treatment otherwise.
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

describe("ProjectNavList project icon", () => {
  it("renders the project's icon when set", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Rocket Project", key: "RK", icon: "🚀" }],
      }),
    );

    expect(screen.getByText("🚀")).toBeInTheDocument();
    // The key badge is suppressed once an icon is set.
    expect(screen.queryByText("RK")).not.toBeInTheDocument();
  });

  it("falls back to the key when no icon is set", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Plain Project", key: "PL", icon: null }],
      }),
    );

    expect(screen.getByText("PL")).toBeInTheDocument();
  });
});
