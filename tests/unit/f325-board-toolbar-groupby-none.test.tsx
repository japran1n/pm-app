// @vitest-environment jsdom
//
// F325 (blocker B6, AS-419): "No grouping" could never be reselected once
// a viewer had a persisted non-none grouping preference, because
// <BoardToolbar>'s handleChange DELETED the `groupBy` URL param instead of
// writing it explicitly to "none" — and board.tsx resolves an ABSENT
// param back to the persisted preference (F226/AS-424), so the URL
// round-tripped straight back to the old grouping. This is a genuine DOM
// interaction test (a real `<select>` change event driving BoardToolbar's
// real `handleChange`), not a source regex: it fails against the old
// `params.delete("groupBy")` implementation (router.push would receive a
// URL with no groupBy param at all) and passes against the fix
// (`params.set("groupBy", "none")`).

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  // Simulates a viewer who already has a persisted non-none grouping
  // reflected in the URL from a previous visit/reload, e.g. "tag".
  useSearchParams: () => new URLSearchParams("groupBy=tag"),
}));

vi.mock("@/lib/actions/board-prefs", () => ({
  upsertBoardSwimlanePrefs: vi.fn(async () => ({ ok: true })),
}));

// The real <Select> (components/ui/select.tsx) wraps @base-ui/react's
// pointer-event-driven combobox, which jsdom cannot reliably drive. This
// feature's bug and fix live entirely inside BoardToolbar's own
// `handleChange` — not inside the Select primitive — so this test
// replaces it with a bare native <select>, wired to the same
// value/onValueChange contract, to exercise the REAL handleChange
// function through a real DOM change event.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      {
        "aria-label": "Group board by",
        value,
        onChange: (e: { target: { value: string } }) => onValueChange(e.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectTrigger: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectValue: () => null,
}));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

describe("F325 board toolbar groupBy=none (AS-419)", () => {
  it("test_AS_419_selecting_No_grouping_writes_an_explicit_groupBy_none_param_not_an_absent_one", async () => {
    const { BoardToolbar } = await import("@/components/board/board-toolbar");

    render(createElement(BoardToolbar, { groupBy: "tag", projectId: "proj-1" }));

    const select = screen.getByLabelText("Group board by");
    fireEvent.change(select, { target: { value: "none" } });

    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    const [destination] = pushMock.mock.calls[0] as [string];
    expect(destination).toContain("groupBy=none");
    // The bug's exact symptom: a URL with the param silently dropped,
    // which board.tsx resolves back to the persisted "tag" grouping.
    expect(destination).not.toBe("/w/acme/projects/proj-1/board");
  });
});
