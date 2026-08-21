// @vitest-environment jsdom
//
// Follow-up (2026-08-21, user-reported): image attachments should render as
// an inline thumbnail in the task detail view instead of only a plain
// filename link. This test file exercises the real React effect + async
// signed-URL-fetch path (components/task/attachment-list.tsx's
// AttachmentThumbnail), which the rest of this repo's attachment tests
// can't cover because they render with `renderToStaticMarkup` (no DOM, no
// effects). A `jsdom` environment + `act` from react-dom/test-utils is used
// here specifically because this behaviour is asynchronous (mint a signed
// URL after mount) and effect-driven — no shortcut around a real DOM
// exists for that.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";

const getAttachmentSignedUrlMock = vi.fn();

vi.mock("@/lib/actions/attachments", () => ({
  getAttachmentSignedUrl: (...args: unknown[]) =>
    getAttachmentSignedUrlMock(...args),
  deleteAttachment: vi.fn(),
  uploadAttachment: vi.fn(),
}));

import { AttachmentList, type TaskAttachment } from "@/components/task/attachment-list";

const MEMBERS = [{ userId: "u1", email: "alice@example.com", name: "Alice" }];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(attachments: TaskAttachment[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(AttachmentList, {
        taskId: "t1",
        attachments,
        members: MEMBERS,
      }),
    );
  });
  return container;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  container?.remove();
  container = null;
  root = null;
  getAttachmentSignedUrlMock.mockReset();
});

const imageAttachment: TaskAttachment = {
  id: "a1",
  taskId: "t1",
  fileName: "screenshot.png",
  fileUrl: "t1/1-screenshot.png",
  uploadedBy: "u1",
  createdAt: new Date().toISOString(),
  mimeType: "image/png",
};

const pdfAttachment: TaskAttachment = {
  id: "a2",
  taskId: "t1",
  fileName: "spec.pdf",
  fileUrl: "t1/2-spec.pdf",
  uploadedBy: "u1",
  createdAt: new Date().toISOString(),
  mimeType: "application/pdf",
};

const legacyNullMimeAttachment: TaskAttachment = {
  id: "a3",
  taskId: "t1",
  fileName: "old-file.dat",
  fileUrl: "t1/3-old-file.dat",
  uploadedBy: "u1",
  createdAt: new Date().toISOString(),
  mimeType: null,
};

describe("AttachmentList inline image thumbnails", () => {
  it("test_image_attachment_renders_a_real_img_with_a_resolved_signed_url_src", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.supabase.co/storage/v1/object/sign/a1?token=abc",
    });

    const el = mount([imageAttachment]);
    await flush();

    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(
      "https://example.supabase.co/storage/v1/object/sign/a1?token=abc",
    );
    expect(getAttachmentSignedUrlMock).toHaveBeenCalledWith("a1");
  });

  it("test_non_image_attachment_never_attempts_a_thumbnail", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.com/should-not-be-used",
    });

    const el = mount([pdfAttachment]);
    await flush();

    expect(el.querySelector("img")).toBeNull();
    // Never proactively minted a signed URL for a non-image attachment.
    expect(getAttachmentSignedUrlMock).not.toHaveBeenCalled();
    // Filename link fallback still renders.
    expect(el.textContent).toContain("spec.pdf");
  });

  it("test_null_mime_type_pre_migration_row_falls_back_gracefully_no_crash", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: true,
      signedUrl: "https://example.com/unused",
    });

    const el = mount([legacyNullMimeAttachment]);
    await flush();

    expect(el.querySelector("img")).toBeNull();
    expect(getAttachmentSignedUrlMock).not.toHaveBeenCalled();
    expect(el.textContent).toContain("old-file.dat");
  });

  it("test_signed_url_fetch_failure_falls_back_to_filename_link_no_broken_img", async () => {
    getAttachmentSignedUrlMock.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    });

    const el = mount([imageAttachment]);
    await flush();

    expect(el.querySelector("img")).toBeNull();
    // The plain filename link is still the working fallback — never a
    // silent gap.
    expect(el.textContent).toContain("screenshot.png");
  });
});
