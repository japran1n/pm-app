// @vitest-environment jsdom
//
// F008 (PL-030): "Archived cards use the same frame as the active card;
// show archived date/by and Restore (admin/owner only) instead of
// progress/team." Tests derive from the assertion text, not the
// implementation: the card must render an archived date + archiver, gate
// Restore behind canRestore, and must NOT render progress/team affordances
// an active ProjectCard would show.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/project/restore-project-button", () => ({
  RestoreProjectButton: ({ project }: { project: { name: string } }) => (
    <button aria-label={`restore ${project.name}`}>Restore</button>
  ),
}));

import { ArchivedProjectCard } from "@/components/projects/archived-project-card";

const project = {
  id: "p1",
  name: "Alpha",
  description: "Alpha project",
  taskCount: 3,
  archivedAt: "2026-01-15T00:00:00.000Z",
  archivedByName: "Jordan",
};

describe("F008", () => {
  afterEach(cleanup);

  it("test_PL_030_shows_archived_date_and_by_name", () => {
    render(
      <ArchivedProjectCard project={project} workspaceId="w1" canRestore={false} />,
    );
    const dateEl = screen.getByTestId("archived-date");
    expect(dateEl.textContent).toMatch(/Jan/);
    expect(dateEl.className).toContain("font-mono");
    expect(screen.getByText(/Jordan/).textContent).toContain("by Jordan");
  });

  it("test_PL_030_restore_button_shown_only_when_canRestore", () => {
    const { rerender } = render(
      <ArchivedProjectCard project={project} workspaceId="w1" canRestore={false} />,
    );
    expect(screen.queryByLabelText(`restore ${project.name}`)).toBeNull();

    rerender(
      <ArchivedProjectCard project={project} workspaceId="w1" canRestore={true} />,
    );
    expect(screen.getByLabelText(`restore ${project.name}`)).toBeTruthy();
  });

  it("test_PL_030_no_progress_or_team_affordances", () => {
    render(
      <ArchivedProjectCard project={project} workspaceId="w1" canRestore={true} />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("card-team")).toBeNull();
  });

  it("test_PL_030_same_card_frame_as_active_card", () => {
    render(
      <ArchivedProjectCard project={project} workspaceId="w1" canRestore={false} />,
    );
    // Same hover-lift/border-control-hover frame class as the active
    // ProjectCard (components/projects/project-card.tsx) -- shared
    // styling rather than a re-derived card shell.
    const card = screen.getByText("Alpha").closest(".group\\/card");
    expect(card).toBeTruthy();
    expect(card?.className).toContain("hover:border-border-control-hover");
  });
});
