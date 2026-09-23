// @vitest-environment jsdom
//
// F015 (PL-028, plus PL-002..PL-006): real render of ProjectCardActions
// (not a vi.mock stub as tests/unit/project-card-f004.test.tsx uses for
// ProjectCard) so the canArchive / canSaveTemplate gate logic itself is
// under test. This must fail if the `canArchive &&` guard around the
// "Archive" DropdownMenuItem is ever removed.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// The dialogs mutate via Server Actions (saveProjectAsTemplate, editProject,
// archiveProject) — irrelevant to this feature's gate assertions and not
// safe to invoke in a unit test, so they're mocked out. This only removes
// the *dialogs' own* network calls; the menu item rendering logic under
// test (ProjectCardActions itself) is not mocked.
vi.mock("@/lib/actions/templates", () => ({ saveProjectAsTemplate: vi.fn() }));
vi.mock("@/lib/actions/projects", () => ({
  editProject: vi.fn(),
  archiveProject: vi.fn(),
}));

import { ProjectCardActions } from "@/components/projects/project-card-actions";

const project = {
  id: "p1",
  name: "Alpha",
  description: "d",
  startDate: null,
  endDate: null,
  icon: null,
};

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /more actions/i }));
  return user;
}

describe("F015 PL-028 ProjectCardActions role gates", () => {
  afterEach(cleanup);

  it("test_PL_028_canArchive_true_shows_archive_menu_item", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive
        canSaveTemplate
        project={project}
      />,
    );
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
  });

  it("test_PL_028_canArchive_false_hides_archive_menu_item", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive={false}
        canSaveTemplate
        project={project}
      />,
    );
    await openMenu();
    // Edit and Save as template remain — only Archive is gated by canArchive.
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("test_PL_002_canSaveTemplate_true_enables_save_as_template_item", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive
        canSaveTemplate
        project={project}
      />,
    );
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: "Save as template" });
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("test_PL_003_canSaveTemplate_false_disables_save_as_template_item_but_keeps_it_visible", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive
        canSaveTemplate={false}
        project={project}
      />,
    );
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: "Save as template" });
    expect(item).toBeTruthy();
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("title")).toBe(
      "You don't have permission to save templates.",
    );
  });

  it("test_PL_004_edit_menu_item_always_present_regardless_of_gates", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive={false}
        canSaveTemplate={false}
        project={project}
      />,
    );
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
  });

  it("test_PL_005_no_gates_hides_archive_and_disables_template", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive={false}
        canSaveTemplate={false}
        project={project}
      />,
    );
    await openMenu();
    const item = await screen.findByRole("menuitem", {
      name: "Save as template",
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("test_PL_006_both_gates_true_shows_all_three_enabled_items", async () => {
    render(
      <ProjectCardActions
        workspaceId="w"
        canArchive
        canSaveTemplate
        project={project}
      />,
    );
    await openMenu();
    await screen.findByRole("menuitem", { name: "Archive" });
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual(["Save as template", "Edit", "Archive"]);
  });
});
