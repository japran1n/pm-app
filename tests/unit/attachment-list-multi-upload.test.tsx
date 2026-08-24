// @vitest-environment jsdom
//
// F258 (AS-501, AS-503): AttachmentList's imperative `uploadFiles` handle
// is what AttachmentDropzone (components/task/attachment-dropzone.tsx)
// calls into on drop, so a drag-drop upload funnels through the exact
// same `uploadAttachment` Server Action + local-state append the
// pre-existing file-picker path already used (F066) — not a second,
// parallel upload implementation.

import { createElement, createRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const uploadAttachmentMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/actions/attachments", () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
  getAttachmentSignedUrl: vi.fn(async () => ({ ok: false, error: "n/a" })),
  deleteAttachment: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

import {
  AttachmentList,
  type AttachmentListHandle,
} from "@/components/task/attachment-list";

afterEach(() => {
  cleanup();
  uploadAttachmentMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

describe("AttachmentList.uploadFiles (F258: AS-501, AS-503)", () => {
  it("test_AS_501_dropped_file_funnels_through_the_existing_uploadAttachment_action", async () => {
    uploadAttachmentMock.mockResolvedValue({
      ok: true,
      data: {
        id: "att-1",
        taskId: "t1",
        fileName: "dropped.png",
        fileUrl: "t1/1-dropped.png",
        uploadedBy: "u1",
        createdAt: new Date().toISOString(),
        signedUrl: "https://example.com/signed",
        mimeType: "image/png",
      },
    });

    const ref = createRef<AttachmentListHandle>();
    render(
      createElement(AttachmentList, {
        ref,
        taskId: "t1",
        attachments: [],
        members: [],
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );

    const file = new File(["x"], "dropped.png", { type: "image/png" });
    ref.current!.uploadFiles([file]);

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1);
    });

    const formData = uploadAttachmentMock.mock.calls[0][0] as FormData;
    expect(formData.get("taskId")).toBe("t1");
    expect(formData.get("file")).toBe(file);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it("test_AS_503_multiple_dropped_files_all_upload", async () => {
    uploadAttachmentMock.mockImplementation(async (formData: FormData) => {
      const file = formData.get("file") as File;
      return {
        ok: true,
        data: {
          id: `att-${file.name}`,
          taskId: "t1",
          fileName: file.name,
          fileUrl: `t1/${file.name}`,
          uploadedBy: "u1",
          createdAt: new Date().toISOString(),
          signedUrl: "https://example.com/signed",
          mimeType: file.type,
        },
      };
    });

    const ref = createRef<AttachmentListHandle>();
    render(
      createElement(AttachmentList, {
        ref,
        taskId: "t1",
        attachments: [],
        members: [],
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );

    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
      new File(["c"], "c.png", { type: "image/png" }),
    ];
    ref.current!.uploadFiles(files);

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(3);
    });

    const uploadedNames = uploadAttachmentMock.mock.calls
      .map((call) => (call[0] as FormData).get("file") as File)
      .map((file) => file.name)
      .sort();
    expect(uploadedNames).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("test_AS_507_a_disallowed_file_is_rejected_before_upload_shows_a_reason_and_never_calls_the_action", async () => {
    const ref = createRef<AttachmentListHandle>();
    render(
      createElement(AttachmentList, {
        ref,
        taskId: "t1",
        attachments: [],
        members: [],
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );

    const badFile = new File(["#!/bin/sh"], "script.sh", {
      type: "application/x-sh",
    });
    ref.current!.uploadFiles([badFile]);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("script.sh"),
      );
    });
    // AS-507: never sent to the server at all — nothing that could leave a
    // partial `attachments` row was ever attempted.
    expect(uploadAttachmentMock).not.toHaveBeenCalled();

    const row = await screen.findByTestId("upload-progress-row");
    expect(row).toHaveAttribute("data-status", "rejected");
    expect(row.textContent).toContain("script.sh");
    expect(row.textContent).toMatch(/not allowed/i);
  });

  it("test_AS_504_a_valid_file_shows_an_uploading_row_that_settles_to_success", async () => {
    let resolveUpload!: (value: unknown) => void;
    uploadAttachmentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const ref = createRef<AttachmentListHandle>();
    render(
      createElement(AttachmentList, {
        ref,
        taskId: "t1",
        attachments: [],
        members: [],
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );

    const file = new File(["x"], "notes.png", { type: "image/png" });
    ref.current!.uploadFiles([file]);

    const row = await screen.findByTestId("upload-progress-row");
    expect(row).toHaveAttribute("data-status", "uploading");

    resolveUpload({
      ok: true,
      data: {
        id: "att-1",
        taskId: "t1",
        fileName: "notes.png",
        fileUrl: "t1/notes.png",
        uploadedBy: "u1",
        createdAt: new Date().toISOString(),
        signedUrl: "https://example.com/signed",
        mimeType: "image/png",
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("upload-progress-row")).toHaveAttribute(
        "data-status",
        "success",
      );
    });
  });

  it("test_AS_503_viewer_role_cannot_upload_via_drop", async () => {
    const ref = createRef<AttachmentListHandle>();
    render(
      createElement(AttachmentList, {
        ref,
        taskId: "t1",
        attachments: [],
        members: [],
        currentUserId: "u1",
        currentUserRole: "viewer",
      }),
    );

    const file = new File(["a"], "a.png", { type: "image/png" });
    ref.current!.uploadFiles([file]);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
  });
});
