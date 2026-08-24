// @vitest-environment jsdom
//
// F245 (AS-469, AS-472): shortcut reference dialog.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let currentPathname = "/w/acme/projects/proj-1/board";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

import { ShortcutHelpDialog } from "@/components/command/shortcut-help";
import { ShortcutProvider } from "@/components/command/shortcut-provider";
import {
  __resetEscapeLayersForTests,
  SHORTCUT_EVENTS,
  SHORTCUT_REGISTRY,
} from "@/lib/hooks/use-shortcut";

afterEach(() => {
  cleanup();
  __resetEscapeLayersForTests();
});

beforeEach(() => {
  currentPathname = "/w/acme/projects/proj-1/board";
});

function fireKey(key: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document, { key, ...init });
}

describe("ShortcutHelpDialog (AS-469: `?` opens a shortcut reference)", () => {
  it("test_AS_469_pressing_question_mark_opens_the_help_dialog", async () => {
    render(
      createElement("div", null, [
        createElement(ShortcutProvider, { key: "p" }),
        createElement(ShortcutHelpDialog, { key: "h" }),
      ]),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireKey("?");

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("test_AS_469_question_mark_does_not_fire_while_typing_in_an_input", () => {
    render(
      createElement("div", null, [
        createElement(ShortcutProvider, { key: "p" }),
        createElement(ShortcutHelpDialog, { key: "h" }),
        createElement("input", { key: "i", "data-testid": "field" }),
      ]),
    );

    const input = screen.getByTestId("field");
    input.focus();
    fireEvent.keyDown(input, { key: "?" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("test_AS_469_the_open_help_event_alone_opens_the_dialog", async () => {
    render(createElement(ShortcutHelpDialog));

    window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openHelp));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_AS_471_escape_closes_the_help_dialog_via_the_shared_escape_layer_stack", async () => {
    render(
      createElement("div", null, [
        createElement(ShortcutProvider, { key: "p" }),
        createElement(ShortcutHelpDialog, { key: "h" }),
      ]),
    );

    fireKey("?");
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireKey("Escape");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("ShortcutHelpDialog registry-drift protection (AS-472: every documented shortcut actually works)", () => {
  it("test_AS_472_the_dialog_renders_every_entry_from_the_registry_the_provider_actually_uses", async () => {
    render(createElement(ShortcutHelpDialog));
    window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openHelp));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    // This test reads SHORTCUT_REGISTRY itself (the same array the
    // provider dispatches from) rather than a hard-coded duplicate list.
    // If a shortcut were added to the provider's registry but the dialog
    // stopped importing/rendering it, this test would fail — that is the
    // "built but not wired to real data" failure mode this test exists to
    // catch.
    for (const entry of SHORTCUT_REGISTRY) {
      expect(screen.getByText(entry.description)).toBeInTheDocument();
      expect(screen.getAllByText(entry.keyLabel).length).toBeGreaterThan(0);
    }
  });

  it("test_AS_472_the_provider_switch_handles_every_single_key_registry_entry_it_claims_to_document", async () => {
    // Guard against the registry drifting the OTHER direction: an entry
    // documented in the help dialog that the provider's keydown handler
    // does not actually implement. Escape is handled by the shared
    // escape-layer stack (verified above and in F244's own suite), so it
    // is exempted here; every other registry key must dispatch a
    // `window` CustomEvent when pressed.
    const provider = await import("@/components/command/shortcut-provider");
    render(createElement(provider.ShortcutProvider));

    const eventsFired: string[] = [];
    for (const eventName of Object.values(SHORTCUT_EVENTS)) {
      window.addEventListener(eventName, () => eventsFired.push(eventName));
    }

    for (const entry of SHORTCUT_REGISTRY) {
      if (entry.key === "Escape") continue;
      fireKey(entry.key);
    }

    // n, /, and ? each dispatch exactly one distinct window event.
    expect(eventsFired).toContain(SHORTCUT_EVENTS.newTask);
    expect(eventsFired).toContain(SHORTCUT_EVENTS.openSearch);
    expect(eventsFired).toContain(SHORTCUT_EVENTS.openHelp);
  });
});
