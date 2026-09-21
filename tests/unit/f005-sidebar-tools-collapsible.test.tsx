// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => createElement("div"),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const props = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "T", email: "t@example.com", avatarUrl: null },
  isGuest: false,
};
const toolLinks = (b: HTMLElement) =>
  b.getAttribute("aria-controls")!.split(" ").map((id) => document.getElementById(id)!);
const toolsBtn = () => screen.getAllByRole("button", { name: /tools/i }).find((b) => b.hasAttribute("aria-expanded"))!;

function installStorage(overrides: Partial<Storage> = {}) {
  const m = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    ...overrides,
  };
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
}
beforeEach(() => installStorage());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SB-020: Tools collapsible", () => {
  it("SB-020 header is a button with aria-expanded that hides/shows links", () => {
    render(createElement(AppSidebar, props));
    const b = toolsBtn();
    expect(b).toHaveAttribute("aria-expanded", "true");
    const links = toolLinks(b);
    links.forEach((l) => expect(l).toBeVisible());
    fireEvent.click(b);
    expect(toolsBtn()).toHaveAttribute("aria-expanded", "false");
    links.forEach((l) => expect(l).not.toBeVisible());
    fireEvent.click(toolsBtn());
    links.forEach((l) => expect(l).toBeVisible());
  });
});

describe("SB-021: Tools state persisted", () => {
  it("SB-021 collapsed state is restored from localStorage on mount", async () => {
    window.localStorage.setItem("sidebar:tools-open", "false");
    render(createElement(AppSidebar, props));
    await waitFor(() => expect(toolsBtn()).toHaveAttribute("aria-expanded", "false"));
  });
  it("SB-021 toggle writes to localStorage", () => {
    render(createElement(AppSidebar, props));
    fireEvent.click(toolsBtn());
    expect(window.localStorage.getItem("sidebar:tools-open")).toBe("false");
  });
  it("SB-021 throwing localStorage still renders expanded without console errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => {
      throw new Error("denied");
    };
    installStorage({ getItem: boom, setItem: boom });
    render(createElement(AppSidebar, props));
    expect(toolsBtn()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toolsBtn());
    expect(toolsBtn()).toHaveAttribute("aria-expanded", "false");
    // SB-021: NO console.error at all (not merely none mentioning "denied").
    expect(err.mock.calls).toEqual([]);
  });
});

describe("SB-022: distinct tool icons", () => {
  it("SB-022 each Tools item renders a different lucide icon", () => {
    render(createElement(AppSidebar, props));
    const b = toolsBtn();
    const links = toolLinks(b);
    expect(links.length).toBe(3);
    const classes = links.map((a) =>
      Array.from(a.querySelector("svg")!.classList).find((c) => c.startsWith("lucide-") && c !== "lucide"),
    );
    expect(new Set(classes).size).toBe(3);
  });
});
