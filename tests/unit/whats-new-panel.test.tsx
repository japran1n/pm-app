// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// Feature request: in-app "What's new" panel. Render/seen-state coverage --
// the static entry list itself, the unseen indicator dot showing until the
// panel is opened once, and that opening persists "seen" across remounts
// (localStorage-backed, see the component's own doc comment).
import { WhatsNewPanel, hasUnseenWhatsNew } from "@/components/whats-new/whats-new-panel";

// jsdom in this repo's configuration has no window.localStorage (see
// tests/unit/palette-actions-recents.test.tsx's own comment for the same
// polyfill) -- a minimal in-memory implementation, scoped to this file.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
    configurable: true,
  });
}

describe("WhatsNewPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  it("shows the unseen indicator dot before the panel has ever been opened", () => {
    expect(hasUnseenWhatsNew()).toBe(true);
    render(<WhatsNewPanel />);
    expect(screen.getByTestId("whats-new-unseen-dot")).toBeTruthy();
  });

  it("opening the panel renders the static feature list", () => {
    render(<WhatsNewPanel />);
    fireEvent.click(screen.getByRole("button", { name: /what's new/i }));
    expect(screen.getByText(/Chat & direct messages/i)).toBeTruthy();
    expect(screen.getByText(/Time tracking/i)).toBeTruthy();
  });

  it("opening the panel clears the unseen indicator and it stays cleared on remount", () => {
    const { unmount } = render(<WhatsNewPanel />);
    fireEvent.click(screen.getByRole("button", { name: /what's new/i }));

    expect(screen.queryByTestId("whats-new-unseen-dot")).toBeFalsy();
    expect(hasUnseenWhatsNew()).toBe(false);

    unmount();
    render(<WhatsNewPanel />);
    expect(screen.queryByTestId("whats-new-unseen-dot")).toBeFalsy();
  });
});
