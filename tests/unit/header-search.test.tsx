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
