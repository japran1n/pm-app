// @vitest-environment jsdom
//
// Mission 20260914-portal-simplify, F011 (AS-020): the project settings
// sub-nav names the exact portal surface each client-feeding tab's content
// appears under, so a PM editing e.g. Deliverables knows it shows up under
// the portal's "For you".
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/proj-1/settings",
}));

import { ProjectSettingsNav } from "./project-settings-nav";

afterEach(() => {
  cleanup();
});

const EXPECTED: Record<string, string> = {
  deliverables: "For you",
  record: "Scope & decisions",
  measurement: "Results",
  site: "Your site",
  portal: "Home",
  phases: "Home",
};

describe("ProjectSettingsNav (AS-020)", () => {
  it("test_AS_020_each_client_feeding_tab_shows_its_own_client_sees_subtitle", () => {
    render(<ProjectSettingsNav workspaceSlug="acme" projectId="proj-1" />);

    for (const [slug, expectedName] of Object.entries(EXPECTED)) {
      const subtitle = screen.getByTestId(`settings-nav-client-sees-${slug}`);
      expect(subtitle).toHaveTextContent(`Client sees: ${expectedName}`);
      expect(subtitle.className).toContain("text-muted-foreground");
    }
  });

  it("test_AS_020_tabs_with_no_direct_portal_surface_render_no_subtitle", () => {
    render(<ProjectSettingsNav workspaceSlug="acme" projectId="proj-1" />);

    expect(screen.queryByTestId("settings-nav-client-sees-members")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-nav-client-sees-columns")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-nav-client-sees-custom-fields"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-nav-client-sees-budget")).not.toBeInTheDocument();
  });
});
