// @vitest-environment jsdom
//
// F260 (AS-505, AS-506): DOM-level proof that clicking an image attachment
// opens a full-size preview, that Escape closes it (cooperating with the
// shared escape-layer stack, F244), that next/previous navigate across the
// task's other image attachments and mint a fresh signed URL each time, and
// that focus returns to the trigger on close.

import { createElement } from "react";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { __resetEscapeLayersForTests } from "@/lib/hooks/use-shortcut";

const getAttachmentSignedUrlMock = vi.fn();
const deleteAttachmentMock = vi.fn();
const uploadAttachmentMock = vi.fn();

vi.mock("@/lib/actions/attachments", () => ({
  getAttachmentSignedUrl: (...args: unknown[]) =>
    getAttachmentSignedUrlMock(...args),
  deleteAttachment: (...args: unknown[]) => deleteAttachmentMock(...args),
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
}));

import { AttachmentList, type TaskAttachment } from "@/components/task/attachment-list";
import { ShortcutProvider } from "@/components/command/shortcut-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
}));

const MEMBERS = [{ userId: "u1", email: "alice@example.com", name: "Alice" }];

const image1: TaskAttachment = {
  id: "a1",
  taskId: "t1",
  fileName: "first.png",
  fileUrl: "t1/1-first.png",
  uploadedBy: "u1",
  createdAt: new Date().toISOString(),
  mimeType: "image/png",
};

const image2: TaskAttachment = {
  id: "a2",
  taskId: "t1",
  fileName: "second.png",
  fileUrl: "t1/2-second.png",
  uploadedBy: "u1",
  createdAt: new Date().toISOString(),
  mimeType: "image/png",
};

const pdfAttachment: TaskAttachment = {
  id: "a3",
  taskId: "t1",
  fileName: "spec.pdf",
  fileUrl: "t1/3-spec.pdf",
  uploadedBy: "u1",
  createdAt: new Date().toISOString(),
  mimeType: "application/pdf",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  __resetEscapeLayersForTests();
  document.body.innerHTML = "";
  getAttachmentSignedUrlMock.mockReset();
});

function renderList(attachments: TaskAttachment[]) {
  return render(
    createElement(
      "div",
      null,
      createElement(ShortcutProvider),
      createElement(AttachmentList, {
        taskId: "t1",
        attachments,
        members: MEMBERS,
      }),
    ),
  );
}

describe("Image lightbox (AS-505, AS-506)", () => {
  it("test_AS_505_an_image_attachment_renders_a_thumbnail_img_not_a_generic_icon", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.supabase.co/sign/a1?token=abc",
    });

    renderList([image1]);

    await waitFor(() => expect(screen.getByAltText("first.png")).toBeInTheDocument());
    expect(screen.getByAltText("first.png").tagName).toBe("IMG");
  });

  it("test_AS_505_a_non_image_attachment_still_shows_the_generic_file_icon_no_thumbnail", async () => {
    renderList([pdfAttachment]);

    expect(screen.queryByAltText("spec.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
  });

  it("test_AS_506_clicking_an_image_thumbnail_opens_a_full_size_preview", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.supabase.co/sign/a1?token=abc",
    });

    renderList([image1]);

    await waitFor(() => expect(screen.getByAltText("first.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open first.png" }));

    await waitFor(() =>
      expect(screen.getByTestId("image-lightbox")).toBeInTheDocument(),
    );
    // Fresh signed URL minted for the lightbox itself, not reused from the
    // thumbnail's earlier mint.
    expect(getAttachmentSignedUrlMock).toHaveBeenCalledWith("a1");
  });

  it("test_AS_506_Escape_closes_the_lightbox_cooperating_with_the_shared_escape_layer_stack", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.supabase.co/sign/a1?token=abc",
    });

    renderList([image1]);
    await waitFor(() => expect(screen.getByAltText("first.png")).toBeInTheDocument());

    const trigger = screen.getByRole("button", { name: "Open first.png" });
    // jsdom's fireEvent.click does not move real focus the way a browser
    // click does — focus it explicitly first so the component's "focus
    // restored to the trigger" behaviour has something real to restore to.
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByTestId("image-lightbox")).toBeInTheDocument(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument(),
    );

    // AS-506: focus restored to the trigger on close.
    expect(document.activeElement).toBe(trigger);
  });

  it("test_AS_506_next_and_previous_navigate_across_the_tasks_other_image_attachments_refreshing_the_signed_url", async () => {
    getAttachmentSignedUrlMock.mockImplementation((attachmentId: string) =>
      Promise.resolve({
        ok: true,
        signedUrl: `https://example.supabase.co/sign/${attachmentId}?token=abc`,
      }),
    );

    renderList([image1, image2]);
    await waitFor(() => expect(screen.getByAltText("first.png")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Open first.png" }));
    await waitFor(() =>
      expect(screen.getByTestId("image-lightbox")).toBeInTheDocument(),
    );

    getAttachmentSignedUrlMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));

    await waitFor(() =>
      expect(getAttachmentSignedUrlMock).toHaveBeenCalledWith("a2"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));

    await waitFor(() =>
      expect(getAttachmentSignedUrlMock).toHaveBeenCalledWith("a1"),
    );
  });

  it("test_AS_506_previous_is_disabled_on_the_first_image_and_next_is_disabled_on_the_last", async () => {
    getAttachmentSignedUrlMock.mockImplementation((attachmentId: string) =>
      Promise.resolve({
        ok: true,
        signedUrl: `https://example.supabase.co/sign/${attachmentId}?token=abc`,
      }),
    );

    renderList([image1, image2]);
    await waitFor(() => expect(screen.getByAltText("first.png")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Open first.png" }));
    await waitFor(() =>
      expect(screen.getByTestId("image-lightbox")).toBeInTheDocument(),
    );

    expect(screen.getByRole("button", { name: "Previous image" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next image" })).not.toBeDisabled();
  });

  it("test_AS_506_clicking_the_close_button_closes_the_lightbox_and_restores_focus", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.supabase.co/sign/a1?token=abc",
    });

    renderList([image1]);
    await waitFor(() => expect(screen.getByAltText("first.png")).toBeInTheDocument());

    const trigger = screen.getByRole("button", { name: "Open first.png" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByTestId("image-lightbox")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));

    await waitFor(() =>
      expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
  });
});
