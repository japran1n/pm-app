// @vitest-environment jsdom
//
// F020: the sidebar renders every `error` event as a human sentence, with
// `no_api_key` styled neutrally (it's a configuration state, not a
// failure) and everything else (rate_limit, thread_limit, ...) styled as
// a warning. Mocks lib/ai/use-doc-assistant.ts directly so the `error`
// value can be driven straight from the test, mirroring
// tests/unit/f009-assistant-sidebar.test.tsx's harness/localStorage-
// polyfill pattern for this same component.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

let mockError: { code: string; message: string } | null = null;

vi.mock("@/lib/ai/use-doc-assistant", () => ({
  useDocAssistant: () => ({
    // F020: the error region only renders inside AssistantThread (F010),
    // which only mounts once there's at least one message — mirrors a
    // real turn where the user has already sent something before an
    // error event arrives.
    messages: [{ id: "m1", role: "user" as const, text: "hello" }],
    toolCalls: [],
    proposals: [],
    isStreaming: false,
    error: mockError,
    usage: null,
    send: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
  }),
}));

import { BreadcrumbProvider } from "@/components/nav/breadcrumb-context";
import {
  AssistantSidebar,
  AssistantSidebarProvider,
  AssistantSidebarToggle,
} from "@/components/ai/assistant-sidebar";

function Harness() {
  return (
    <BreadcrumbProvider>
      <AssistantSidebarProvider>
        <AssistantSidebarToggle />
        <AssistantSidebar workspaceId="w1" hasApiKey={true} />
      </AssistantSidebarProvider>
    </BreadcrumbProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname = "/w/acme/docs";
  mockError = null;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function openSidebar() {
  render(<Harness />);
  fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));
  await waitFor(() => {
    expect(screen.getByTestId("assistant-sidebar")).toBeInTheDocument();
  });
}

describe("F020: sidebar error rendering", () => {
  it("renders no_api_key as a human sentence with no warning/red styling", async () => {
    mockError = { code: "no_api_key", message: "The AI assistant is not configured yet." };
    await openSidebar();

    const el = await screen.findByTestId("assistant-sidebar-error");
    expect(el).toHaveTextContent("The AI assistant is not configured yet.");
    expect(el.getAttribute("data-error-tone")).toBe("neutral");
    expect(el.className).not.toMatch(/status-waiting/);
  });

  it("renders rate_limit as a human sentence with warning styling", async () => {
    mockError = { code: "rate_limit", message: "Too many requests, please wait 30 seconds." };
    await openSidebar();

    const el = await screen.findByTestId("assistant-sidebar-error");
    expect(el).toHaveTextContent("Too many requests, please wait 30 seconds.");
    expect(el.getAttribute("data-error-tone")).toBe("warning");
    expect(el.className).toMatch(/status-waiting/);
  });

  it("renders thread_limit as a human sentence suggesting a new chat", async () => {
    mockError = {
      code: "thread_limit",
      message: "This conversation has reached its context limit. Start a new chat to continue.",
    };
    await openSidebar();

    const el = await screen.findByTestId("assistant-sidebar-error");
    expect(el).toHaveTextContent(/new chat/i);
    expect(el.getAttribute("data-error-tone")).toBe("warning");
  });

  it("renders an unrecognised error code as a generic, non-blank sentence", async () => {
    mockError = { code: "something_new", message: "" };
    await openSidebar();

    const el = await screen.findByTestId("assistant-sidebar-error");
    expect(el.textContent?.trim().length).toBeGreaterThan(0);
  });
});
