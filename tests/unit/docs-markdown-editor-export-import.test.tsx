// @vitest-environment jsdom
//
// Docs export/import (Markdown). Storage format for a doc is already a
// plain Markdown string (markdown-editor.tsx's own top comment), so:
//   - Export downloads the editor's live Markdown content as a .md file.
//   - Import reads a chosen .md file's text, loads it into the editor, and
//     persists it via the existing autosave path (`updateDoc`).
//
// Mounts the real MarkdownEditor (real Tiptap/`tiptap-markdown`, not
// stubbed) so the export/import buttons are exercised against genuine
// Markdown serialization/parsing, not a hand-rolled stand-in.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MarkdownEditor } from "@/components/docs/markdown-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const updateDoc = vi.fn();
vi.mock("@/lib/actions/docs", () => ({
  updateDoc: (...args: unknown[]) => updateDoc(...args),
  setDocKind: vi.fn(),
  setDocRelevantFrom: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/approvals/request-approval-dialog", () => ({
  RequestApprovalDialog: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DOC_ID = "11111111-1111-4111-8111-111111111111";

describe("MarkdownEditor export/import as Markdown", () => {
  it("test_export_button_downloads_the_current_markdown_content_as_a_md_file", async () => {
    updateDoc.mockResolvedValue({});
    render(
      <MarkdownEditor
        docId={DOC_ID}
        initialTitle="My Notes"
        initialContent="# Hello\n\nSome **bold** text."
      />,
    );

    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    // jsdom doesn't implement these — stub them for the assertion.
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL =
      createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL =
      revokeObjectURL;

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    fireEvent.click(await screen.findByRole("button", { name: /export \.md/i }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toContain("text/markdown");
    const text = await blob.text();
    expect(text).toContain("Hello");
    expect(text).toContain("bold");
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("test_import_button_loads_a_chosen_md_files_content_into_the_editor_and_saves_it", async () => {
    updateDoc.mockResolvedValue({});
    render(
      <MarkdownEditor docId={DOC_ID} initialTitle="Empty doc" initialContent="" />,
    );

    const file = new File(["## Imported heading\n\nImported body text."], "notes.md", {
      type: "text/markdown",
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(screen.getByText(/imported heading/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(updateDoc).toHaveBeenCalled();
      const lastCall = updateDoc.mock.calls.at(-1)!;
      expect(lastCall[0]).toBe(DOC_ID);
      expect(String(lastCall[2])).toContain("Imported body text");
    });
  });

  it("test_import_rejects_a_non_markdown_file_with_an_error_toast_and_does_not_change_content", async () => {
    const { toast } = await import("sonner");
    render(
      <MarkdownEditor docId={DOC_ID} initialTitle="Doc" initialContent="Original content" />,
    );

    const file = new File(["binary junk"], "image.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Please choose a .md (Markdown) file.");
    });
    expect(screen.getByText("Original content")).toBeInTheDocument();
  });
});
