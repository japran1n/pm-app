// @vitest-environment jsdom
//
// F009: behavioural tests for the docs assistant sidebar shell
// (components/ai/assistant-sidebar.tsx).
//
// Covers:
// - AS-060: the sidebar opens from the header toggle and its open/closed
//   state survives a reload (persisted to localStorage, restored on
//   mount).
// - AS-061: the context bar shows the currently open doc's title and
//   updates on navigation without remounting (and therefore without
//   clearing) the panel's own thread state.
// - AS-070: no hex colour literals anywhere in the component's source.
// - AS-071: with no API key configured, the panel still renders and the
//   composer region shows one clear, non-destructive explanatory message.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let mockPathname = "/w/acme/docs";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// jsdom in this repo's configuration has no window.localStorage (see
// tests/unit/whats-new-panel.test.tsx's own comment for the same
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

import { BreadcrumbProvider, useSetBreadcrumb } from "@/components/nav/breadcrumb-context";
import {
  AssistantSidebar,
  AssistantSidebarProvider,
  AssistantSidebarToggle,
} from "@/components/ai/assistant-sidebar";

const STORAGE_KEY = "pm-app:ai-docs-sidebar-open";

function AnnounceDocTitle({ title }: { title: string }) {
  useSetBreadcrumb([{ label: title }]);
  return null;
}

function Harness({
  workspaceId = "w1",
  hasApiKey = true,
  docTitle,
}: {
  workspaceId?: string;
  hasApiKey?: boolean;
  docTitle?: string;
}) {
  return (
    <BreadcrumbProvider>
      <AssistantSidebarProvider>
        {docTitle !== undefined && <AnnounceDocTitle title={docTitle} />}
        <AssistantSidebarToggle />
        <AssistantSidebar workspaceId={workspaceId} hasApiKey={hasApiKey} />
      </AssistantSidebarProvider>
    </BreadcrumbProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname = "/w/acme/docs";
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("F009 AS-060: sidebar toggle + persisted open/closed state", () => {
  it("is closed by default and opens when the header toggle is clicked", async () => {
    render(<Harness />);

    expect(screen.queryByTestId("assistant-sidebar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toBeInTheDocument();
    });
  });

  it("persists the open state to localStorage and restores it on a fresh mount (reload)", async () => {
    const { unmount } = render(<Harness />);

    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));
    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    });

    unmount();

    // Simulates a page reload: a brand-new mount reading the SAME
    // localStorage key.
    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toBeInTheDocument();
    });
  });

  it("closing again persists the closed state", async () => {
    const { unmount } = render(<Harness />);

    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));
    await waitFor(() => {
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
    });

    unmount();
    render(<Harness />);
    await waitFor(() => {
      expect(screen.queryByTestId("assistant-sidebar")).not.toBeInTheDocument();
    });
  });

  it("never throws even if localStorage access itself throws (private browsing)", async () => {
    const originalGetItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("private browsing");
    };

    expect(() => render(<Harness />)).not.toThrow();

    window.localStorage.getItem = originalGetItem;
  });
});

describe("F009 AS-061: context bar tracks the currently open doc", () => {
  it("shows the announced doc title in the context bar", async () => {
    mockPathname = "/w/acme/docs/doc-1";
    render(<Harness docTitle="Doc One" />);
    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toHaveTextContent("Doc One");
    });
  });

  it("updates the title on navigation to a different doc without remounting the panel (thread preserved)", async () => {
    mockPathname = "/w/acme/docs/doc-1";
    const { rerender } = render(<Harness docTitle="Doc One" />);
    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toHaveTextContent("Doc One");
    });

    const nodeBeforeNav = screen.getByTestId("assistant-sidebar");

    mockPathname = "/w/acme/docs/doc-2";
    act(() => {
      rerender(<Harness docTitle="Doc Two" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toHaveTextContent("Doc Two");
    });
    expect(screen.getByTestId("assistant-sidebar")).not.toHaveTextContent("Doc One");

    // Same DOM node identity across the navigation == the panel (and the
    // useDocAssistant hook instance it owns) was never unmounted, so any
    // in-progress thread state would have survived.
    expect(screen.getByTestId("assistant-sidebar")).toBe(nodeBeforeNav);
  });

  it("falls back to a decorative 'no doc open' hint when no doc is open", async () => {
    mockPathname = "/w/acme/docs";
    render(<Harness />);
    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar-no-doc-hint")).toBeInTheDocument();
    });
  });
});

describe("F009 AS-070: no new colour literals", () => {
  it("contains no hex colour literals in its source", () => {
    const source = readFileSync(
      join(process.cwd(), "components/ai/assistant-sidebar.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("F009 AS-071: no API key configured", () => {
  it("still renders the panel and shows one explanatory, non-destructive message with the composer disabled", async () => {
    mockPathname = "/w/acme/docs/doc-1";
    render(<Harness docTitle="Doc One" hasApiKey={false} />);
    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toBeInTheDocument();
    });

    const notice = screen.getByTestId("assistant-sidebar-no-api-key");
    expect(notice).toBeInTheDocument();
    // Configuration state, not an error: must not use destructive styling.
    expect(notice.className).not.toMatch(/destructive/);
    // No functioning composer input rendered alongside the notice.
    expect(
      screen.queryByTestId("assistant-sidebar-composer-placeholder"),
    ).not.toBeInTheDocument();
  });

  it("renders the composer region (not the no-API-key notice) when an API key IS configured", async () => {
    mockPathname = "/w/acme/docs/doc-1";
    render(<Harness docTitle="Doc One" hasApiKey={true} />);
    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(
        screen.getByTestId("assistant-sidebar-composer-placeholder"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("assistant-sidebar-no-api-key"),
    ).not.toBeInTheDocument();
  });
});
