// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, fireEvent, act, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";

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
afterEach(cleanup);

function setDims(el: HTMLElement, sh: number, ch: number, top: number) {
  Object.defineProperty(el, "scrollHeight", { value: sh, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: ch, configurable: true });
  el.scrollTop = top;
}

describe("F006", () => {
  it("test_SB_023_desktop_nav_items_are_32px_and_mobile_keeps_touch_target", () => {
    render(createElement(AppSidebar, props));
    const link = screen.getAllByRole("link", { name: /dashboard/i })[0];
    expect(link.className).toContain("md:h-8");
    expect(link.className).toContain("max-md:min-h-11");
  });

  it("test_SB_024_bottom_fade_visible_only_when_overflowing_and_not_at_bottom", () => {
    render(createElement(AppSidebar, props));
    const scroll = screen.getAllByTestId("sidebar-scroll")[0];
    expect(screen.queryByTestId("sidebar-bottom-fade")).toBeNull();
    act(() => { setDims(scroll, 800, 400, 0); fireEvent.scroll(scroll); });
    expect(screen.getByTestId("sidebar-bottom-fade")).toBeInTheDocument();
    act(() => { setDims(scroll, 800, 400, 400); fireEvent.scroll(scroll); });
    expect(screen.queryByTestId("sidebar-bottom-fade")).toBeNull();
    act(() => { setDims(scroll, 300, 400, 0); fireEvent.scroll(scroll); });
    expect(screen.queryByTestId("sidebar-bottom-fade")).toBeNull();
  });

  it("test_SB_008_no_hex_or_forbidden_classes_in_touched_files", () => {
    for (const f of ["components/nav/app-sidebar.tsx", "components/nav/project-nav-list.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/#[0-9a-fA-F]{6}\b|#ffffff0d/);
      expect(s).not.toMatch(/font-\[(510|590)\]|text-mini|text-micro|title-/);
    }
  });

  it("test_SB_009_mobile_sheet_uses_same_sidebar_content", () => {
    render(createElement(AppSidebar, props));
    // Real hamburger (the old /menu/i matched the desktop AccountMenu trigger).
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });
});
