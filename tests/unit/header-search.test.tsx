// @vitest-environment jsdom
//
// F267 (AS-519, AS-520, AS-521, AS-522): the header search input --
// always present, shows matching tasks/projects as the user types
// without leaving the page, selecting a result navigates to it, and
// Enter opens the full /search page with the same query.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const searchPalette = vi.fn();

vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: (...args: unknown[]) => searchPalette(...args),
}));

import { HeaderSearch } from "@/components/nav/header-search";
import { __resetEscapeLayersForTests, popTopEscapeLayer } from "@/lib/hooks/use-shortcut";

const defaultProps = { workspaceId: "ws-1", workspaceSlug: "acme" };

afterEach(() => {
  cleanup();
  push.mockClear();
  searchPalette.mockReset();
  __resetEscapeLayersForTests();
});

function typeQuery(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("HeaderSearch (F267)", () => {
  it("test_AS_519_a_search_input_renders_in_the_header_on_a_workspace_page", () => {
    render(createElement(HeaderSearch, defaultProps));
    expect(
      screen.getByRole("combobox", { name: /search tasks and projects/i }),
    ).toBeInTheDocument();
  });

  it("test_AS_520_typing_shows_matching_tasks_and_projects_in_a_dropdown_without_navigating", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix header layout",
          projectId: "proj-1",
          projectName: "Marketing Site",
          projectKey: "MKT",
          number: 7,
        },
      ],
      members: [
        { type: "member", userId: "u1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
      ],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });

    typeQuery(input, "market");

    await waitFor(() => {
      expect(searchPalette).toHaveBeenCalledWith("ws-1", "market");
    });

    await waitFor(() => {
      expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    });
    expect(screen.getByText("Fix header layout")).toBeInTheDocument();
    // AS-520 wording is specifically "tasks and projects" -- members are
    // the command palette's own concern, not rendered here.
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

    // Still on the same page -- no navigation happened just from typing.
    expect(push).not.toHaveBeenCalled();
  });

  it("test_AS_520_negative_no_matches_shows_an_explicit_no_results_state_not_a_blank_dropdown", async () => {
    searchPalette.mockResolvedValue({ projects: [], tasks: [], members: [] });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });

    typeQuery(input, "zzzznomatch");

    await waitFor(() => {
      expect(screen.getByText("No results found.")).toBeInTheDocument();
    });
  });

  it("test_AS_521_selecting_a_project_result_navigates_to_it", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });
    typeQuery(input, "market");

    const option = await screen.findByText("Marketing Site");
    fireEvent.mouseDown(option);

    expect(push).toHaveBeenCalledWith("/w/acme/projects/proj-1/board");
  });

  it("test_AS_521_selecting_a_task_result_navigates_to_it", async () => {
    searchPalette.mockResolvedValue({
      projects: [],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix header layout",
          projectId: "proj-9",
          projectName: "Marketing Site",
          projectKey: "MKT",
          number: 7,
        },
      ],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });
    typeQuery(input, "fix header");

    const option = await screen.findByText("Fix header layout");
    fireEvent.mouseDown(option);

    expect(push).toHaveBeenCalledWith("/w/acme/projects/proj-9/board");
  });

  it("test_AS_522_enter_opens_the_full_search_page_with_the_same_query", async () => {
    searchPalette.mockResolvedValue({ projects: [], tasks: [], members: [] });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });
    typeQuery(input, "invoice bug");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/w/acme/search?q=invoice%20bug");
  });

  it("test_AS_522_negative_enter_with_an_empty_query_does_not_navigate", () => {
    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).not.toHaveBeenCalled();
  });

  it("test_AS_523_arrow_down_and_enter_select_a_result_with_no_mouse_involvement", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix header layout",
          projectId: "proj-9",
          projectName: "Marketing Site",
          projectKey: "MKT",
          number: 7,
        },
      ],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });
    typeQuery(input, "market");

    await screen.findByText("Marketing Site");

    // ArrowDown twice moves past the project option onto the task option
    // (projects render first), purely via the keyboard.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/w/acme/projects/proj-9/board");
  });

  it("test_AS_523_arrow_up_wraps_to_the_last_option_and_reflects_aria_activedescendant", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", {
      name: /search tasks and projects/i,
    }) as HTMLInputElement;
    typeQuery(input, "market");

    await screen.findByText("Marketing Site");

    // No option highlighted yet.
    expect(input).not.toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(input, { key: "ArrowUp" });

    const option = screen.getByRole("option", { name: /Marketing Site/i });
    expect(input).toHaveAttribute("aria-activedescendant", option.id);
    expect(option).toHaveAttribute("aria-selected", "true");
  });

  it("test_AS_523_home_and_end_jump_to_first_and_last_option", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix header layout",
          projectId: "proj-9",
          projectName: "Marketing Site",
          projectKey: "MKT",
          number: 7,
        },
      ],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });
    typeQuery(input, "market");

    await screen.findByText("Marketing Site");

    fireEvent.keyDown(input, { key: "End" });
    let options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "Home" });
    options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("test_AS_524_all_options_and_icon_only_visuals_expose_an_accessible_name_or_are_hidden_from_the_a11y_tree", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", { name: /search tasks and projects/i });
    typeQuery(input, "market");

    // The input itself (the one "control" this component owns outside the
    // dropdown) has an explicit aria-label.
    expect(input).toHaveAttribute("aria-label", "Search tasks and projects");

    const option = await screen.findByRole("option", { name: /Marketing Site/i });
    // The option's accessible name comes from its own visible text (the
    // project name), not from a decorative icon -- the leading
    // FolderKanban icon is aria-hidden and contributes nothing.
    expect(option).toHaveAccessibleName("Marketing SiteMKT");
  });

  it("test_AS_520_escape_clears_the_input_and_closes_the_dropdown_via_the_shared_escape_layer_stack", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [],
      members: [],
    });

    render(createElement(HeaderSearch, defaultProps));
    const input = screen.getByRole("combobox", {
      name: /search tasks and projects/i,
    }) as HTMLInputElement;
    typeQuery(input, "market");

    await screen.findByText("Marketing Site");

    // In the real app, ShortcutProvider's document keydown listener calls
    // `popTopEscapeLayer()` on Escape (see components/command/
    // shortcut-provider.tsx) -- that provider isn't mounted in this
    // narrow unit test, so this test drives the same shared stack
    // primitive directly rather than duplicating ShortcutProvider's own
    // already-tested keydown wiring here.
    act(() => {
      popTopEscapeLayer();
    });

    await waitFor(() => {
      expect(screen.queryByText("Marketing Site")).not.toBeInTheDocument();
    });
    expect(input.value).toBe("");
  });
});
