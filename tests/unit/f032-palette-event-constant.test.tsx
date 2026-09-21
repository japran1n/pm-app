// @vitest-environment jsdom
//
// F032 (FU-18 / SB-031): the sidebar Search button and the CommandPalette
// share ONE event-name constant, and the palette removes its listeners on
// unmount.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {} }), usePathname: () => "/w/acme" }));
vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: async () => ({ projects: [], tasks: [], members: [] }),
  resolveRecentItems: async () => ({ projects: [], tasks: [] }),
}));
vi.mock("@/lib/hooks/use-palette-search-realtime", () => ({ usePaletteSearchRealtime() {} }));
vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "admin", hasClient: true, projectRoles: {} }),
}));

import { CommandPalette } from "@/components/command/command-palette";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/lib/hooks/use-shortcut";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

afterEach(cleanup);

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function request() {
  const detail = { handled: false };
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, { detail }));
  return detail;
}

describe("F032 shared command-palette event constant (SB-031)", () => {
  it("test_SB_031_sidebar_and_palette_import_the_shared_constant_not_a_literal", () => {
    const sidebar = read("components/nav/app-sidebar.tsx");
    const palette = read("components/command/command-palette.tsx");
    const shared = read("lib/hooks/use-shortcut.ts");
    expect(sidebar).toMatch(/COMMAND_PALETTE_OPEN_EVENT[^;]*from "@\/lib\/hooks\/use-shortcut"/);
    expect(palette).toMatch(/COMMAND_PALETTE_OPEN_EVENT[^;]*from "@\/lib\/hooks\/use-shortcut"/);
    expect(sidebar).not.toContain('"command-palette:open"');
    expect(palette).not.toContain('"command-palette:open"');
    // Defined exactly once, in the client-safe shared module.
    expect(shared).toMatch(/export const COMMAND_PALETTE_OPEN_EVENT = /);
    expect(palette).not.toMatch(/export const COMMAND_PALETTE_OPEN_EVENT/);
    // The shared module must stay free of server actions.
    expect(shared).not.toMatch(/lib\/actions|"use server"/);
  });

  it("test_SB_031_mounted_palette_answers_the_shared_event_and_opens", async () => {
    render(createElement(CommandPalette, { workspaceId: "w1", workspaceSlug: "acme" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    let detail!: { handled: boolean };
    act(() => {
      detail = request();
    });
    expect(detail.handled).toBe(true);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("test_SB_031_unmounted_palette_removes_open_listener_so_caller_falls_back", () => {
    const { unmount } = render(createElement(CommandPalette, { workspaceId: "w1", workspaceSlug: "acme" }));
    unmount();
    expect(request().handled).toBe(false);
  });

  it("test_SB_032_unmounted_palette_removes_keydown_listener", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(createElement(CommandPalette, { workspaceId: "w1", workspaceSlug: "acme" }));
    const keydownAdds = add.mock.calls.filter((c) => c[0] === "keydown");
    expect(keydownAdds.length).toBe(1);
    unmount();
    const handler = keydownAdds[0][1];
    expect(remove.mock.calls.some((c) => c[0] === "keydown" && c[1] === handler)).toBe(true);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    add.mockRestore();
    remove.mockRestore();
  });
});
