// @vitest-environment jsdom
//
// Mission 20260914-portal-simplify, F011 (AS-020): the Architecture board
// header names where a shared page shows up in the portal, for the team
// building the sitemap -- "Shared pages appear to the client under Site
// map" (F008's own renamed portal nav item, formerly "Architecture").
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/architecture/board", () => ({
  ArchitectureBoard: () => <div data-testid="architecture-board-stub" />,
}));
vi.mock("@/components/architecture/canvas-board", () => ({
  CanvasBoard: () => <div data-testid="canvas-board-stub" />,
}));

import { ArchitectureViewToggle } from "./architecture-view-toggle";

afterEach(() => {
  cleanup();
});

describe("ArchitectureViewToggle (AS-020)", () => {
  it("test_AS_020_the_board_header_names_the_portal_surface_shared_pages_appear_under", () => {
    render(
      <ArchitectureViewToggle
        pages={[]}
        components={[]}
        projectId="proj-1"
        projectName="Acme"
      />,
    );

    const note = screen.getByTestId("architecture-client-visibility-note");
    expect(note).toHaveTextContent("Shared pages appear to the client under Site map.");
    expect(note.className).toContain("text-muted-foreground");
  });
});
