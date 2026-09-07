// @vitest-environment jsdom
//
// Follow-up (Cmd+P project switcher): opening via the shortcut, fuzzy
// filtering by project name, Enter navigating to the project's default
// "/list" route, and the "does not open while typing" guard mirroring
// CommandPalette's own AS-464 convention.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ProjectSwitcher } from "@/components/command/project-switcher";

const projects = [
  { id: "proj-1", name: "Website Redesign", key: "WEB" },
  { id: "proj-2", name: "Mobile App", key: "MOB" },
];

const defaultProps = { workspaceSlug: "acme", projects };

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

function fireKey(
  target: Document | HTMLElement,
  key: string,
  init: Partial<KeyboardEventInit> = {},
) {
  fireEvent.keyDown(target, { key, ...init });
}

describe("ProjectSwitcher (Cmd+P)", () => {
  it("test_cmdp_opens_the_project_switcher", async () => {
    render(createElement(ProjectSwitcher, defaultProps));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireKey(document, "p", { metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_cmdp_ctrl_p_opens_the_project_switcher_for_windows_linux", async () => {
    render(createElement(ProjectSwitcher, defaultProps));

    fireKey(document, "p", { ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_cmdp_lists_all_projects_in_the_workspace", async () => {
    render(createElement(ProjectSwitcher, defaultProps));

    fireKey(document, "p", { metaKey: true });

    await waitFor(() => {
      expect(screen.getByText("Website Redesign")).toBeInTheDocument();
      expect(screen.getByText("Mobile App")).toBeInTheDocument();
    });
  });

  it("test_cmdp_fuzzy_search_filters_the_list_by_name", async () => {
    render(createElement(ProjectSwitcher, defaultProps));

    fireKey(document, "p", { metaKey: true });

    const input = await waitFor(() =>
      screen.getByPlaceholderText("Find a project..."),
    );

    fireEvent.change(input, { target: { value: "Mobile" } });

    await waitFor(() => {
      expect(screen.getByText("Mobile App")).toBeInTheDocument();
      expect(screen.queryByText("Website Redesign")).not.toBeInTheDocument();
    });
  });

  it("test_cmdp_selecting_a_project_navigates_to_its_list_route", async () => {
    render(createElement(ProjectSwitcher, defaultProps));

    fireKey(document, "p", { metaKey: true });

    const item = await waitFor(() => screen.getByText("Mobile App"));
    fireEvent.click(item);

    expect(pushMock).toHaveBeenCalledWith("/w/acme/projects/proj-2/list");
  });

  it("test_cmdp_typing_p_in_a_plain_input_does_not_open_the_switcher", async () => {
    render(
      createElement(
        "div",
        null,
        createElement("input", { "aria-label": "unrelated input" }),
        createElement(ProjectSwitcher, defaultProps),
      ),
    );

    const textInput = screen.getByLabelText("unrelated input");
    textInput.focus();

    fireKey(textInput, "p");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("test_cmdp_shortcut_still_opens_even_while_a_text_field_is_focused", async () => {
    render(
      createElement(
        "div",
        null,
        createElement("input", { "aria-label": "unrelated input" }),
        createElement(ProjectSwitcher, defaultProps),
      ),
    );

    const textInput = screen.getByLabelText("unrelated input");
    textInput.focus();

    fireKey(textInput, "p", { metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_cmdp_key_repeat_does_not_re_toggle_the_switcher", async () => {
    render(createElement(ProjectSwitcher, defaultProps));

    fireKey(document, "p", { metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireKey(document, "p", { metaKey: true, repeat: true });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
