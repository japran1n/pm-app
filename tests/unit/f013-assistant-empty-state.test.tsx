// @vitest-environment jsdom
//
// F013: behavioural tests for the docs assistant's empty state and
// suggestion chips (components/ai/assistant-sidebar.tsx's
// `AssistantEmptyState`), plus the `usage` wiring from
// lib/ai/use-doc-assistant.ts through to the composer's meta row.
//
// Covers:
// - AS-068: the empty state offers at least three suggestion chips, and
//   clicking one submits it immediately.
// - AS-069: chips are real, keyboard-focusable buttons with a visible
//   focus state.
// - AS-070: no new hex colour literals in the sidebar's source.

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/w/acme/docs";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

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

// Mock fetch so `send()` (triggered by clicking a chip) doesn't hit a
// real network endpoint — we only need to prove `send` was invoked with
// the chip's exact text, which is observable via the resulting user
// message bubble rendered by AssistantThread.
const originalFetch = global.fetch;
beforeEach(() => {
  window.localStorage.clear();
  mockPathname = "/w/acme/docs";
  global.fetch = vi.fn(
    () =>
      new Promise(() => {
        // Never resolves — we only need the request to have been made
        // and the optimistic user message to have been appended.
      }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  global.fetch = originalFetch;
});

import { BreadcrumbProvider, useSetBreadcrumb } from "@/components/nav/breadcrumb-context";
import {
  AssistantSidebar,
  AssistantSidebarProvider,
  AssistantSidebarToggle,
} from "@/components/ai/assistant-sidebar";

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

async function openSidebar(props?: Parameters<typeof Harness>[0]) {
  render(<Harness {...props} />);
  fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));
  await waitFor(() => {
    expect(screen.getByTestId("assistant-sidebar")).toBeInTheDocument();
  });
}

describe("F013 AS-068: empty state suggestion chips", () => {
  it("shows the documents-only limit in plain language before any message is sent", async () => {
    await openSidebar();
    const emptyState = screen.getByTestId("assistant-sidebar-empty-state");
    expect(emptyState).toHaveTextContent(/docs/i);
    // States what it cannot do, in the empty state itself (not just on
    // first refusal).
    expect(emptyState.textContent).toMatch(/can.?t|cannot/i);
  });

  it("offers at least three suggestion chips", async () => {
    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it("clicking a chip submits it immediately (a user message appears without further interaction)", async () => {
    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    const chipText = chips[0].textContent ?? "";
    expect(chipText.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(chips[0]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toHaveTextContent(chipText);
    });
    // The empty state placeholder itself is gone once a message exists.
    expect(
      screen.queryByTestId("assistant-sidebar-empty-state"),
    ).not.toBeInTheDocument();
  });

  it("grounds suggestions in the current document when one is open", async () => {
    mockPathname = "/w/acme/docs/doc-1";
    await openSidebar({ docTitle: "Doc One" });
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    const allText = chips.map((c) => c.textContent).join(" ");
    expect(allText).toMatch(/missing before I send this to the client|Shorten the introduction/i);
  });

  it("falls back to doc-independent suggestions when no doc is open", async () => {
    mockPathname = "/w/acme/docs";
    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    const allText = chips.map((c) => c.textContent).join(" ");
    expect(allText).toMatch(/draft a new doc from material/i);
  });
});

describe("F013 AS-069: chips are keyboard-reachable buttons with a visible focus state", () => {
  it("renders each chip as a real <button> element", async () => {
    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    for (const chip of chips) {
      expect(chip.tagName).toBe("BUTTON");
      expect(chip).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("has visible-focus classes on every chip", async () => {
    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    for (const chip of chips) {
      expect(chip.className).toMatch(/focus-visible:/);
    }
  });

  it("is reachable and activatable via keyboard focus", async () => {
    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");
    chips[0].focus();
    expect(document.activeElement).toBe(chips[0]);
  });
});

describe("F013 AS-070: no new colour literals", () => {
  it("contains no hex colour literals in the sidebar's source", () => {
    const source = readFileSync(
      join(process.cwd(), "components/ai/assistant-sidebar.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("F013: usage wired through the hook into the composer's meta row", () => {
  it("shows a live token readout once a usage event streams in", async () => {
    let capturedController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const encoder = new TextEncoder();
    global.fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          capturedController = controller;
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    await openSidebar();
    const chips = screen.getAllByTestId("assistant-sidebar-suggestion-chip");

    act(() => {
      fireEvent.click(chips[0]);
    });

    await waitFor(() => {
      expect(capturedController).not.toBeNull();
    });

    act(() => {
      capturedController!.enqueue(
        encoder.encode('{"t":"usage","in":120,"out":340,"cached":0}\n'),
      );
      capturedController!.enqueue(encoder.encode('{"t":"done"}\n'));
      capturedController!.close();
    });

    await waitFor(() => {
      expect(screen.getByTestId("assistant-composer-usage")).toHaveTextContent(
        "460",
      );
    });
  });
});
