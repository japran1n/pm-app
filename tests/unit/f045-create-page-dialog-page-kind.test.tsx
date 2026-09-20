// @vitest-environment jsdom
//
// Mission 20260919-150607, F045 (AS-152, AS-153, AS-154): CreatePageDialog
// lets a user choose the page_kind at creation time instead of hardcoding
// "static".

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("server-only", () => ({}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const createPage = vi.fn(async () => ({
  ok: true,
  data: { title: "New page" },
}));
vi.mock("@/lib/actions/architecture", () => ({
  createPage: (...args: unknown[]) =>
    (createPage as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CreatePageDialog } from "@/components/architecture/create-page-dialog";

afterEach(() => {
  cleanup();
  createPage.mockClear();
  refresh.mockClear();
});

describe("F045 page_kind in create-page-dialog", () => {
  it("AS-152: renders the page_kind selector", () => {
    render(<CreatePageDialog projectId="proj-1" open onOpenChange={() => {}} />);

    expect(
      screen.getByRole("button", { name: /change page kind/i }),
    ).toBeInTheDocument();
  });

  it("AS-153: default page_kind is static", () => {
    render(<CreatePageDialog projectId="proj-1" open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /change page kind/i }));

    expect(screen.getByRole("option", { name: /static/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("AS-154: the selected page_kind is passed to createPage", async () => {
    render(<CreatePageDialog projectId="proj-1" open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /change page kind/i }));
    fireEvent.click(screen.getByRole("option", { name: /cms$/i }));

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Pricing" },
    });

    fireEvent.click(screen.getByRole("button", { name: /add page/i }));

    await vi.waitFor(() => {
      expect(createPage).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({ page_kind: "cms" }),
      );
    });
  });
});
