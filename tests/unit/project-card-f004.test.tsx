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
