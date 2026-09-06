// @vitest-environment jsdom
//
// Render coverage for components/portal/scope-documents.tsx — the Scope &
// Decisions portal page's "Documents & links" panel. Mocks
// lib/actions/scope-documents.ts (a "use server" module) the same way
// other component tests in this suite mock Server Actions, since jsdom
// cannot execute a real Server Action.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ScopeDocuments } from "@/components/portal/scope-documents";
import type { ScopeDocument } from "@/lib/queries/project-scope-documents";

vi.mock("@/lib/actions/scope-documents", () => ({
  createScopeDocumentLink: vi.fn(),
  deleteScopeDocument: vi.fn(),
  getScopeDocumentSignedUrl: vi.fn(),
  uploadScopeDocument: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  createScopeDocumentLink,
  deleteScopeDocument,
  getScopeDocumentSignedUrl,
} from "@/lib/actions/scope-documents";

afterEach(cleanup);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function makeDocument(overrides: Partial<ScopeDocument> = {}): ScopeDocument {
  return {
    id: "doc-1",
    projectId: PROJECT_ID,
    title: "Figma proposal",
    kind: "link",
    filePath: null,
    url: "https://www.figma.com/file/abc123",
    uploadedBy: "user-1",
    uploadedByName: "Alex PM",
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("ScopeDocuments render (Scope & Decisions attachments)", () => {
  it("test_AS_scope_documents_empty_state_when_no_documents", () => {
    render(<ScopeDocuments projectId={PROJECT_ID} documents={[]} canManage={false} />);
    expect(screen.getByText(/No documents or links attached yet\./i)).toBeInTheDocument();
  });

  it("test_AS_scope_documents_lists_existing_documents_with_uploader_and_date", () => {
    const doc = makeDocument();
    render(<ScopeDocuments projectId={PROJECT_ID} documents={[doc]} canManage={false} />);

    const row = screen.getByTestId("scope-document-row");
    expect(row).toHaveTextContent("Figma proposal");
    expect(row).toHaveTextContent("Alex PM");
  });

  it("test_AS_scope_documents_add_button_hidden_for_a_caller_who_cannot_manage", () => {
    render(<ScopeDocuments projectId={PROJECT_ID} documents={[]} canManage={false} />);
    expect(screen.queryByTestId("add-scope-document-trigger")).not.toBeInTheDocument();
  });

  it("test_AS_scope_documents_add_button_visible_for_a_caller_who_can_manage", () => {
    render(<ScopeDocuments projectId={PROJECT_ID} documents={[]} canManage={true} />);
    expect(screen.getByTestId("add-scope-document-trigger")).toBeInTheDocument();
  });

  it("test_AS_scope_documents_delete_control_hidden_for_a_caller_who_cannot_manage", () => {
    render(<ScopeDocuments projectId={PROJECT_ID} documents={[makeDocument()]} canManage={false} />);
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("test_AS_scope_documents_submitting_a_link_calls_createScopeDocumentLink_and_appends_it", async () => {
    vi.mocked(createScopeDocumentLink).mockResolvedValue({
      ok: true,
      data: makeDocument({ id: "doc-2", title: "New link" }),
    });

    render(<ScopeDocuments projectId={PROJECT_ID} documents={[]} canManage={true} />);

    fireEvent.click(screen.getByTestId("add-scope-document-trigger"));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New link" } });
    fireEvent.click(screen.getByRole("radio", { name: "Add a link" }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://www.figma.com/file/xyz" },
    });

    fireEvent.click(screen.getByRole("button", { name: /add link/i }));

    await waitFor(() => {
      expect(createScopeDocumentLink).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        title: "New link",
        url: "https://www.figma.com/file/xyz",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("New link")).toBeInTheDocument();
    });
  });

  it("test_AS_scope_documents_deleting_a_document_calls_deleteScopeDocument_and_removes_it", async () => {
    vi.mocked(deleteScopeDocument).mockResolvedValue({ ok: true, data: { id: "doc-1" } });

    render(<ScopeDocuments projectId={PROJECT_ID} documents={[makeDocument()]} canManage={true} />);

    fireEvent.click(screen.getByRole("button", { name: /remove figma proposal/i }));

    await waitFor(() => {
      expect(deleteScopeDocument).toHaveBeenCalledWith("doc-1");
    });

    await waitFor(() => {
      expect(screen.queryByText("Figma proposal")).not.toBeInTheDocument();
    });
  });

  it("test_AS_scope_documents_opening_an_upload_kind_document_requests_a_signed_url", async () => {
    vi.mocked(getScopeDocumentSignedUrl).mockResolvedValue({
      ok: true,
      signedUrl: "https://signed.example.com/file.pdf",
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const uploadDoc = makeDocument({
      id: "doc-3",
      kind: "upload",
      url: null,
      filePath: `${PROJECT_ID}/contract.pdf`,
      title: "Signed contract",
    });

    render(<ScopeDocuments projectId={PROJECT_ID} documents={[uploadDoc]} canManage={false} />);

    fireEvent.click(screen.getByText("Signed contract"));

    await waitFor(() => {
      expect(getScopeDocumentSignedUrl).toHaveBeenCalledWith("doc-3");
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://signed.example.com/file.pdf",
        "_blank",
        "noopener,noreferrer",
      );
    });

    openSpy.mockRestore();
  });
});
