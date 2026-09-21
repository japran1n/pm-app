// @vitest-environment jsdom
//
// F019 (SB-014): theme toggle works from the account menu. Rendered inside a
// REAL next-themes ThemeProvider (app/layout.tsx config: class + data-theme,
// enableSystem) with no mocks of next-themes.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/actions/auth", () => ({ signOut: vi.fn() }));

import { ThemeProvider } from "@/components/theme-provider";
import { AccountMenu } from "@/components/nav/account-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const props = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "t@example.com", avatarUrl: null },
  canManageWorkspace: true,
};

function stubSystemScheme(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderWithProvider(child: React.ReactElement, defaultTheme: string) {
  return render(
    createElement(
      ThemeProvider,
      { attribute: ["class", "data-theme"], defaultTheme, enableSystem: true, disableTransitionOnChange: true },
      child,
    ),
  );
}

// jsdom in this setup exposes no usable localStorage; install an in-memory one.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
};
vi.stubGlobal("localStorage", memoryStorage);
Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });

const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().className = "";
  html().removeAttribute("data-theme");
});
afterEach(() => cleanup());

describe("test_SB_014_theme_toggle_works_from_menu", () => {
  it("first click on Theme flips html class/data-theme from dark to light under system default, and persists", async () => {
    stubSystemScheme(true);
    renderWithProvider(createElement(AccountMenu, props), "system");
    expect(html()).toHaveClass("dark");

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByText("Theme"));

    expect(html()).toHaveClass("light");
    expect(html()).not.toHaveClass("dark");
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("first click flips light to dark under a light system, and the choice survives a remount (reload)", async () => {
    stubSystemScheme(false);
    const first = renderWithProvider(createElement(AccountMenu, props), "system");
    expect(html()).toHaveClass("light");

    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Theme"));
    expect(html()).toHaveClass("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    first.unmount();
    html().className = "";
    html().removeAttribute("data-theme");
    renderWithProvider(createElement(AccountMenu, props), "system");
    expect(html()).toHaveClass("dark");
  });

  it("standalone ThemeToggle also flips on first click under system default", () => {
    stubSystemScheme(true);
    renderWithProvider(createElement(ThemeToggle), "system");
    expect(html()).toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(html()).toHaveClass("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
