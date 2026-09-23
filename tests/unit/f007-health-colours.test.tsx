// @vitest-environment jsdom
//
// F007 (PL-023/024): health colours are derived design-system tokens (never
// hex/rgb literals), and the time-pill is rendered as a pill Badge whose
// colour is driven by the computed health. These are behaviour tests: they
// render the real `ProjectCard` and inspect the rendered elements' computed
// classes/attributes, rather than matching a regex against raw JSX source.

import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/project-favorite-button", () => ({
  ProjectFavoriteButton: () => <button aria-label="fav" />,
}));
vi.mock("@/components/projects/project-card-actions", () => ({
  ProjectCardActions: () => <button aria-label="actions" />,
}));

import { ProjectCard } from "@/components/projects/project-card";
import {
  PROJECT_HEALTH_BAR_CLASS,
  PROJECT_HEALTH_COLORS,
  PROJECT_HEALTH_TEXT_CLASS,
} from "@/lib/projects/compute-health";

const css = readFileSync("app/globals.css", "utf8");

const project = {
  id: "p1",
  name: "Alpha",
  description: null,
  icon: null,
  startDate: null,
  endDate: null,
  openTaskCount: 5,
} as never;

function renderCard(healthInput: object) {
  return render(
    <ProjectCard
      project={project}
      workspaceId="w"
      workspaceSlug="acme"
      canArchive
      canSaveTemplate
      isFavorite={false}
      healthInput={healthInput as never}
    />,
  );
}

describe("F007", () => {
  afterEach(cleanup);

  it("test_PL_023_health_colours_are_tokens_without_hex", () => {
    // Tokens themselves are CSS custom properties, never hex/rgb literals.
    expect(PROJECT_HEALTH_COLORS).toEqual({
      on_track: "var(--brand)",
      at_risk: "var(--warning)",
      overdue: "var(--destructive)",
    });
    expect(JSON.stringify(PROJECT_HEALTH_BAR_CLASS)).not.toMatch(/#|rgb/);

    // Render an overdue project and confirm the progress bar element
    // actually carries the destructive-token class (not a hardcoded
    // colour), by inspecting the rendered element's own className only.
    renderCard({
      overdueTaskCount: 5,
      totalTaskCount: 5,
      doneTaskCount: 1,
      currentPhase: null,
    });
    const bar = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(bar.className).toContain(PROJECT_HEALTH_BAR_CLASS.overdue);
    expect(bar.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it("test_PL_024_time_pill_uses_pill_badge_with_health_colour", () => {
    renderCard({
      overdueTaskCount: 5,
      totalTaskCount: 5,
      doneTaskCount: 1,
      currentPhase: null,
    });
    const pill = screen.getByTestId("time-pill");
    // It's a pill Badge (rounded-full, uppercase pill shape from the
    // Badge component itself), not some ad-hoc span.
    expect(pill.className).toContain("rounded-full");
    expect(pill.className).toContain("uppercase");
    // Its colour is driven by the computed health, via the shared token
    // map — same class the health-bar test above uses, on the element
    // that's actually on screen.
    expect(pill.className).toContain(PROJECT_HEALTH_TEXT_CLASS.overdue);
    expect(pill.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it("test_PL_029_hover_changes_border_only", () => {
    const { container } = renderCard({
      overdueTaskCount: 0,
      totalTaskCount: 0,
      doneTaskCount: 0,
      currentPhase: null,
    });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("hover:border-border-control-hover");
    expect(card.className).not.toContain("hover-lift");
    expect(card.className).not.toMatch(/hover:shadow/);
  });

  it("test_PL_032_tokens_resolve_in_both_themes", () => {
    // defined at :root scope once, derived from knobs (theme-agnostic)
    for (const t of ["--brand:", "--warning:", "--destructive:"])
      expect(css).toContain(t);
    expect(css).toMatch(/\.dark[^{]*\{[\s\S]*--(surface|hue|chroma)/);
  });
});
