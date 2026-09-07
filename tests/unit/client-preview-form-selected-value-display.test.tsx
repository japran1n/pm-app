// @vitest-environment jsdom
//
// Bug fix (F024/AS-052 follow-up): ClientPreviewForm's Client dropdown
// (components/portal/client-preview-form.tsx) rendered the RAW client user
// UUID inside the closed <SelectTrigger> because <SelectValue> had no
// explicit children and fell back to its own default (raw `value` prop)
// resolution, even though <SelectItem> already rendered the correct
// avatar+name JSX. Fixed by passing the same avatar+name JSX as
// <SelectValue>'s children, resolved from the currently selected client.
//
// This mocks @/components/ui/select with a bare native <select> the same
// way tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx does,
// so the assertion below exercises the REAL binding between clientUserId
// state and what SelectValue is given as children — it is not a trivial
// pass regardless of implementation.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let latestValue: string | null | undefined;
let latestOnValueChange: ((value: string | null) => void) | null = null;
let latestId: string | undefined;

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string | null;
    onValueChange: (value: string | null) => void;
    children: ReactNode;
  }) => {
    latestValue = value;
    latestOnValueChange = onValueChange;
    return createElement(Fragment, null, children);
  },
  SelectTrigger: ({ id, children }: { id?: string; children: ReactNode }) => {
    latestId = id;
    return createElement(
      "div",
      { "data-testid": `select-trigger-${id}` },
      children,
    );
  },
  SelectContent: ({ children }: { children: ReactNode }) => {
    const onValueChange = latestOnValueChange;
    const id = latestId;
    const value = latestValue;
    return createElement(
      "select",
      {
        "aria-label": `${id}-native`,
        value: value ?? "",
        onChange: (e: { target: { value: string } }) =>
          onValueChange?.(e.target.value),
      },
      children,
    );
  },
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  // Mirrors the REAL base-ui Select.Value semantics being fixed here:
  // static (non-function) children, when provided, are rendered as-is;
  // when omitted, this stub falls back to the raw value string — exactly
  // reproducing the bug being guarded against.
  SelectValue: ({
    children,
    placeholder,
  }: {
    children?: ReactNode;
    placeholder?: string;
  }) => {
    if (children != null) {
      return createElement("span", { "data-testid": "select-value" }, children);
    }
    return createElement(
      "span",
      { "data-testid": "select-value" },
      latestValue || placeholder,
    );
  },
}));

vi.mock("@/lib/actions/portal-preview", () => ({
  startClientPreview: vi.fn(async () => ({ ok: true, redirectTo: "/x" })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ClientPreviewForm } from "@/components/portal/client-preview-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  latestValue = undefined;
  latestOnValueChange = null;
  latestId = undefined;
});

describe("ClientPreviewForm — selected client display (bug fix)", () => {
  it("test_client_select_shows_selected_client_name_not_raw_uuid", () => {
    const client = {
      userId: "f6cb6d96-1449-4507-8567-009c4f0b2ea7",
      name: "Petra Vidak",
      email: "petra@meridian.example",
      avatarUrl: null,
    };

    render(
      createElement(ClientPreviewForm, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        clients: [client],
        projects: [],
      }),
    );

    const trigger = screen.getByTestId("select-trigger-preview-client");

    // The closed trigger must display the human-readable name...
    expect(trigger.textContent).toContain("Petra Vidak");
    // ...and must NOT display the raw UUID anywhere in its closed state.
    expect(trigger.textContent).not.toContain(client.userId);
  });

  it("test_client_select_falls_back_to_placeholder_when_nothing_selected", () => {
    render(
      createElement(ClientPreviewForm, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        clients: [],
        projects: [],
      }),
    );

    const trigger = screen.getByTestId("select-trigger-preview-client");
    expect(trigger.textContent).toContain("Choose a client");
  });
});
