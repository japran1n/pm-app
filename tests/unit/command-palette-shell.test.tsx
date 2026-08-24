// @vitest-environment jsdom
//
// F241 (AS-459, AS-463, AS-464): the global command palette shell —
// shortcut open, keyboard-operable + Escape close, and the "does not open
// while typing" guard.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; cmdk's CommandList observes its own height
// with one. This is a test-environment shim only (real browsers this app
// targets all implement ResizeObserver natively) — not app behaviour.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: vi.fn(async () => ({ projects: [], tasks: [], members: [] })),
}));

import { CommandPalette } from "@/components/command/command-palette";

const defaultProps = { workspaceId: "ws-1", workspaceSlug: "acme" };

afterEach(() => {
  cleanup();
});

function fireKey(
  target: Document | HTMLElement,
  key: string,
  init: Partial<KeyboardEventInit> = {},
) {
  fireEvent.keyDown(target, { key, ...init });
}

describe("CommandPalette shell", () => {
  it("test_AS_459_cmd_k_opens_the_palette", async () => {
    render(createElement(CommandPalette, defaultProps));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireKey(document, "k", { metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_AS_459_ctrl_k_opens_the_palette_for_windows_linux", async () => {
    render(createElement(CommandPalette, defaultProps));

    fireKey(document, "k", { ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_AS_463_escape_closes_the_palette", async () => {
    render(createElement(CommandPalette, defaultProps));

    fireKey(document, "k", { metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");
    fireKey(dialog, "Escape");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("test_AS_463_input_is_focusable_and_accepts_keyboard_typing", async () => {
    render(createElement(CommandPalette, defaultProps));

    fireKey(document, "k", { metaKey: true });

    const input = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );

    fireEvent.change(input, { target: { value: "hello" } });
    expect(input).toHaveValue("hello");
  });

  it("test_AS_463_dialog_has_accessible_name_via_title", async () => {
    render(createElement(CommandPalette, defaultProps));

    fireKey(document, "k", { metaKey: true });

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAccessibleName("Command palette");
    });
  });

  it("test_AS_464_typing_k_in_a_plain_input_does_not_open_the_palette", async () => {
    render(
      createElement(
        "div",
        null,
        createElement("input", { "aria-label": "unrelated input" }),
        createElement(CommandPalette, defaultProps),
      ),
    );

    const textInput = screen.getByLabelText("unrelated input");
    textInput.focus();

    // Typing an ordinary "k" keystroke (no modifier) while focused in an
    // unrelated text field must never open the palette.
    fireKey(textInput, "k");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("test_AS_464_shortcut_still_opens_the_palette_even_while_a_text_field_is_focused", async () => {
    render(
      createElement(
        "div",
        null,
        createElement("input", { "aria-label": "unrelated input" }),
        createElement(CommandPalette, defaultProps),
      ),
    );

    const textInput = screen.getByLabelText("unrelated input");
    textInput.focus();

    // The explicit shortcut is the ONE exception: it opens the palette
    // even when focus is inside a text field.
    fireKey(textInput, "k", { metaKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_AS_459_key_repeat_does_not_re_toggle_the_palette", async () => {
    render(createElement(CommandPalette, defaultProps));

    fireKey(document, "k", { metaKey: true });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // A held-down chord delivers repeat=true keydowns; these must not
    // toggle the palette closed again.
    fireKey(document, "k", { metaKey: true, repeat: true });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
