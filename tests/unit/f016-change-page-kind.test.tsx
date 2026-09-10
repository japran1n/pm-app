// @vitest-environment jsdom
//
// Mission 20260910-182104, F016 (AS-032): a page's kind can be changed
// after creation.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("server-only", () => ({}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const changePageKind = vi.fn(async () => ({ success: true }));
vi.mock("@/lib/actions/architecture", () => ({
  changePageKind: (...args: unknown[]) =>
    (changePageKind as unknown as (...a: unknown[]) => Promise<{ success: boolean }>)(
      ...args,
    ),
}));

import { PageKindSelector } from "@/components/architecture/page-kind-selector";

afterEach(() => {
  cleanup();
  changePageKind.mockClear();
  refresh.mockClear();
});

describe("F016 change page kind", () => {
  it("AS-032: renders all three page kind options", () => {
    render(<PageKindSelector taskId="task-1" kind="static" />);

    fireEvent.click(screen.getByRole("button", { name: /change page kind/i }));

    expect(screen.getAllByText("Static").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /cms/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /utility/i })).toBeInTheDocument();
  });

  it("AS-032: calls changePageKind with the selected kind for the given page", async () => {
    render(<PageKindSelector taskId="task-1" kind="static" />);

    fireEvent.click(screen.getByRole("button", { name: /change page kind/i }));
    fireEvent.click(screen.getByRole("option", { name: /cms/i }));

    expect(changePageKind).toHaveBeenCalledWith("task-1", "cms");
  });

  it("AS-032: a page's kind can be changed after creation (updates and refreshes)", async () => {
    render(<PageKindSelector taskId="task-2" kind="cms" />);

    fireEvent.click(screen.getByRole("button", { name: /change page kind/i }));
    fireEvent.click(screen.getByRole("option", { name: /utility/i }));

    expect(changePageKind).toHaveBeenCalledWith("task-2", "utility");
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });
});
