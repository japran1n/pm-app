// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/project-favorite-button", () => ({
  ProjectFavoriteButton: () => <button aria-label="fav" />,
}));
vi.mock("@/components/projects/project-card-actions", () => ({
  ProjectCardActions: () => <button aria-label="actions" />,
}));

import { ProjectCard } from "@/components/projects/project-card";
import { UserAvatarGroup } from "@/components/user-avatar-group";

const project = {
  id: "p1", name: "Alpha", description: "d", icon: null, startDate: null,
  endDate: null, openTaskCount: 5,
} as never;
const hi = { overdueTaskCount: 0, totalTaskCount: 4, doneTaskCount: 2, currentPhase: null } as never;
const render1 = () =>
  render(
    <ProjectCard project={project} workspaceId="w" workspaceSlug="acme"
      canArchive canSaveTemplate isFavorite={false} healthInput={hi} />,
  );

describe("F004", () => {
  afterEach(cleanup);
  it("test_PL_007_open_task_count_shown", () => {
    render1();
    expect(screen.getByText(/open task/).textContent).toBe("5 open tasks");
  });
  it("test_PL_028_link_star_and_actions_preserved", () => {
    render1();
    expect(screen.getAllByRole("link").some((l) => l.getAttribute("href") === "/w/acme/projects/p1/list")).toBe(true);
    expect(screen.getByLabelText("fav")).toBeTruthy();
    expect(screen.getByLabelText("actions")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
  });
  it("test_PL_026_limit_prop_and_default", () => {
    const people = Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, full_name: `P${i}`, email: `p${i}@x.io` })) as never[];
    const a = render(<UserAvatarGroup people={people} limit={4} />);
    expect(a.getByTestId("avatar-group-overflow").textContent).toBe("+2");
    a.unmount();
    const b = render(<UserAvatarGroup people={people} />);
    expect(b.getByTestId("avatar-group-overflow").textContent).toBe("+3");
  });
});

describe("F005", () => {
  afterEach(cleanup);
  const r = (p: object, h: object) =>
    render(
      <ProjectCard project={{ ...(project as object), ...p } as never} workspaceId="w" workspaceSlug="acme"
        canArchive canSaveTemplate isFavorite={false}
        healthInput={{ ...(hi as object), ...h } as never} />,
    );
  it("test_PL_020_anatomy_due_date_progress_label_in_panel", () => {
    r({ endDate: "2026-12-01" }, {});
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByTestId("due-date").textContent).toBe("2026-12-01");
  });
  it("test_PL_021_subtitle_phase_then_description_line_then_none", () => {
    const { unmount } = r({ description: "\nfirst\nsecond" }, { currentPhase: { name: "Build", state: "active", plannedStart: null, plannedEnd: null } });
    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.queryByText("first")).toBeNull();
    unmount();
    const u2 = r({ description: "\nfirst\nsecond" }, {});
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.queryByText(/second/)).toBeNull();
    u2.unmount();
    r({ description: null }, {});
    expect(screen.queryByText("No description.")).toBeNull();
  });
  it("test_PL_022_progress_percent_and_zero_tasks", () => {
    const u = r({}, { totalTaskCount: 3, doneTaskCount: 1 });
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
    u.unmount();
    r({}, { totalTaskCount: 0, doneTaskCount: 0 });
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("test_PL_027_data_is_mono", () => {
    r({ endDate: "2026-12-01" }, {});
    expect(screen.getByTestId("due-date").className).toContain("font-mono");
    expect(screen.getByText("50%").className).toContain("font-mono");
  });
});
