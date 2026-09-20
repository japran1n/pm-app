// @vitest-environment jsdom
//
// F115 (AS-147, AS-148): hardening the slug editor in
// components/architecture/page-column-header.tsx (originally added by
// F044). M7 scrutiny flagged this component RED for having no tests, no
// router.refresh() after save, a silently-discarding onBlur, missing
// aria wiring on the inline error, a discarded pending flag (double
// submit), no try/catch around the action call, and a bare `/` render
// when `pageSlug` is null.
//
// Mirrors tests/unit/f014-rename-page.test.tsx's "PageColumnHeader"
// describe block pattern: mock @/lib/actions/architecture, next/navigation,
// and sonner, then mount the real component.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { BoardPage } from "@/lib/queries/architecture";

const routerRefresh = vi.fn();
const routerPush = vi.fn();
const changePageSlug = vi.fn();
const renamePage = vi.fn();
const toastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
}));

vi.mock("@/lib/actions/architecture", () => ({
  changePageSlug: (...args: unknown[]) => changePageSlug(...args),
  renamePage: (...args: unknown[]) => renamePage(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

const { PageColumnHeader } = await import(
  "@/components/architecture/page-column-header"
);

// BoardPage's `pageSlug` field is typed as `string`, but the component
// (and this file's tests) treat it as nullable in practice -- see the
// null guard fixed in page-column-header.tsx. `Partial<Omit<...>>` +
// an explicit nullable override keeps the rest of the object honestly
// typed while allowing the null case under test.
function makePage(
  overrides: Partial<Omit<BoardPage, "pageSlug">> & {
    pageSlug?: string | null;
  } = {},
): BoardPage {
  return {
    id: "page-1",
    title: "My Page",
    pageSlug: "my-page",
    pageKind: "static",
    position: 1,
    sections: [],
    ...overrides,
  } as BoardPage;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PageColumnHeader slug editor (AS-147, AS-148)", () => {
  it("AS-147: renders slug below title when pageSlug is non-null", () => {
    render(<PageColumnHeader page={makePage({ pageSlug: "my-page" })} />);

    expect(screen.getByText("/my-page")).toBeInTheDocument();
  });

  it("AS-147: does NOT render slug when pageSlug is null", () => {
    render(<PageColumnHeader page={makePage({ pageSlug: null })} />);

    expect(screen.queryByText(/^\//)).not.toBeInTheDocument();
  });

  it("AS-148: clicking slug enters edit mode with current value", () => {
    render(<PageColumnHeader page={makePage({ pageSlug: "my-page" })} />);

    fireEvent.click(screen.getByText("/my-page"));

    const input = screen.getByDisplayValue("my-page");
    expect(input).toBeInTheDocument();
  });

  it("AS-148: pressing Enter calls changePageSlug with trimmed value", async () => {
    changePageSlug.mockResolvedValue({ success: true });

    render(<PageColumnHeader page={makePage({ pageSlug: "my-page" })} />);

    fireEvent.click(screen.getByText("/my-page"));
    const input = screen.getByDisplayValue("my-page");
    fireEvent.change(input, { target: { value: "  new-slug  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => {
      expect(changePageSlug).toHaveBeenCalledWith("page-1", "new-slug");
    });
    await vi.waitFor(() => {
      expect(routerRefresh).toHaveBeenCalled();
    });
  });

  it("AS-148: failed save shows inline error", async () => {
    changePageSlug.mockResolvedValue({
      success: false,
      error: "Slug already taken.",
    });

    render(<PageColumnHeader page={makePage({ pageSlug: "my-page" })} />);

    fireEvent.click(screen.getByText("/my-page"));
    const input = screen.getByDisplayValue("my-page");
    fireEvent.change(input, { target: { value: "taken-slug" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Slug already taken.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("AS-148: successful save exits edit mode", async () => {
    changePageSlug.mockResolvedValue({ success: true });

    render(<PageColumnHeader page={makePage({ pageSlug: "my-page" })} />);

    fireEvent.click(screen.getByText("/my-page"));
    const input = screen.getByDisplayValue("my-page");
    fireEvent.change(input, { target: { value: "new-slug" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => {
      expect(screen.queryByDisplayValue("new-slug")).not.toBeInTheDocument();
    });
  });

  it("AS-148: Escape exits edit mode without calling changePageSlug", () => {
    render(<PageColumnHeader page={makePage({ pageSlug: "my-page" })} />);

    fireEvent.click(screen.getByText("/my-page"));
    const input = screen.getByDisplayValue("my-page");
    fireEvent.change(input, { target: { value: "abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(changePageSlug).not.toHaveBeenCalled();
    expect(screen.getByText("/my-page")).toBeInTheDocument();
  });
});
