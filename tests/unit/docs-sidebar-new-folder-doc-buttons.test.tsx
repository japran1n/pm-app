// @vitest-environment jsdom
//
// Regression coverage for the Docs sidebar's "New folder" / "New doc"
// buttons (confirmed-broken live: neither reliably created anything nor
// surfaced a failure). Root cause: both handlers used a blocking
// `window.prompt` (unreliable/blocked in embedded or sandboxed contexts)
// and depended solely on `revalidatePath` to refresh the tree, with no
// error feedback and no explicit `router.refresh()`. This test drives the
// buttons the way a user would (click -> type a name -> Enter) and asserts
// the server action is actually invoked with the right args, the router is
// refreshed on success, and a failure surfaces via toast instead of
// silently doing nothing.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DocsSidebar } from "@/components/docs/docs-sidebar";
import type { Doc, DocFolder } from "@/lib/queries/docs";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const createDocFolder = vi.fn();
const createDoc = vi.fn();
const deleteDoc = vi.fn();

vi.mock("@/lib/actions/docs", () => ({
  createDocFolder: (...args: unknown[]) => createDocFolder(...args),
  createDoc: (...args: unknown[]) => createDoc(...args),
  deleteDoc: (...args: unknown[]) => deleteDoc(...args),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function renderSidebar(folders: DocFolder[] = [], docs: Doc[] = []) {
  render(
    <DocsSidebar
      folders={folders}
      docs={docs}
      workspaceSlug="acme"
      workspaceId={WORKSPACE_ID}
    />,
  );
}

describe("DocsSidebar New folder / New doc buttons", () => {
  it("test_new_folder_button_calls_createDocFolder_with_typed_name_and_refreshes_on_success", async () => {
    createDocFolder.mockResolvedValue({ id: "folder-1" });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = await screen.findByPlaceholderText("Folder name");
    fireEvent.change(input, { target: { value: "Handovers" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(createDocFolder).toHaveBeenCalledWith(WORKSPACE_ID, "Handovers", null, null);
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("test_new_folder_button_surfaces_error_toast_instead_of_doing_nothing_on_failure", async () => {
    createDocFolder.mockResolvedValue({ error: "Something went wrong. Please try again in a moment." });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = await screen.findByPlaceholderText("Folder name");
    fireEvent.change(input, { target: { value: "Broken" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Something went wrong. Please try again in a moment.");
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("test_new_folder_button_does_not_submit_an_empty_or_whitespace_name", async () => {
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = await screen.findByPlaceholderText("Folder name");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Folder name")).not.toBeInTheDocument();
    });
    expect(createDocFolder).not.toHaveBeenCalled();
  });

  it("test_new_doc_button_creates_doc_and_navigates_to_its_editor", async () => {
    createDoc.mockResolvedValue({ id: "doc-1" });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New doc" }));

    await waitFor(() => {
      expect(createDoc).toHaveBeenCalledWith(WORKSPACE_ID, null, null);
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/w/acme/docs/doc-1"));
  });

  it("test_new_doc_button_surfaces_error_toast_and_does_not_navigate_on_failure", async () => {
    createDoc.mockResolvedValue({ error: "You must be signed in to create a document." });
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "New doc" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("You must be signed in to create a document.");
    });
    expect(push).not.toHaveBeenCalled();
  });
});
