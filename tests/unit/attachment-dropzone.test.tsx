// @vitest-environment jsdom
//
// F258: drag-and-drop file upload wrapping the task detail sheet.
//
//   AS-501: dropping a file on the task detail attaches it.
//   AS-502: the drop target is visibly highlighted while dragging over it.
//   AS-503: multiple dropped files all upload (funnel-through half; the
//     concurrency-cap half is covered directly in
//     tests/unit/upload-files-with-concurrency.test.ts).
//
// Real DOM render (jsdom, per the F277 opt-in pragma convention) so drag
// events are dispatched and observed against actual nodes rather than
// asserted from source text.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AttachmentDropzone } from "@/components/task/attachment-dropzone";

afterEach(() => {
  cleanup();
});

function makeFileDataTransfer(files: File[]) {
  return {
    types: ["Files"],
    files,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  };
}

describe("AttachmentDropzone (F258: AS-501, AS-502, AS-503)", () => {
  it("test_AS_501_dropping_a_file_calls_onFilesDropped_with_it", () => {
    const onFilesDropped = vi.fn();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    render(
      createElement(
        AttachmentDropzone,
        { onFilesDropped },
        createElement("div", { "data-testid": "sheet-body" }, "content"),
      ),
    );

    const dropTarget = screen.getByTestId("sheet-body").parentElement!;

    fireEvent.dragEnter(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });
    fireEvent.drop(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });

    expect(onFilesDropped).toHaveBeenCalledTimes(1);
    expect(onFilesDropped).toHaveBeenCalledWith([file]);
  });

  it("test_AS_503_dropping_multiple_files_passes_all_of_them_through", () => {
    const onFilesDropped = vi.fn();
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
      new File(["c"], "c.png", { type: "image/png" }),
    ];

    render(
      createElement(
        AttachmentDropzone,
        { onFilesDropped },
        createElement("div", { "data-testid": "sheet-body" }, "content"),
      ),
    );

    const dropTarget = screen.getByTestId("sheet-body").parentElement!;

    fireEvent.drop(dropTarget, {
      dataTransfer: makeFileDataTransfer(files),
    });

    expect(onFilesDropped).toHaveBeenCalledTimes(1);
    expect(onFilesDropped).toHaveBeenCalledWith(files);
  });

  it("test_AS_502_highlight_appears_while_dragging_over_and_clears_on_drop", () => {
    const onFilesDropped = vi.fn();
    const file = new File(["a"], "a.png", { type: "image/png" });

    render(
      createElement(
        AttachmentDropzone,
        { onFilesDropped },
        createElement("div", { "data-testid": "sheet-body" }, "content"),
      ),
    );

    const dropTarget = screen.getByTestId("sheet-body").parentElement!;

    expect(
      screen.queryByTestId("attachment-dropzone-highlight"),
    ).not.toBeInTheDocument();

    fireEvent.dragEnter(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });

    expect(
      screen.getByTestId("attachment-dropzone-highlight"),
    ).toBeInTheDocument();

    fireEvent.drop(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });

    expect(
      screen.queryByTestId("attachment-dropzone-highlight"),
    ).not.toBeInTheDocument();
  });

  it("test_AS_502_highlight_clears_on_dragLeave_of_the_outer_boundary", () => {
    const onFilesDropped = vi.fn();
    const file = new File(["a"], "a.png", { type: "image/png" });

    render(
      createElement(
        AttachmentDropzone,
        { onFilesDropped },
        createElement("div", { "data-testid": "sheet-body" }, "content"),
      ),
    );

    const dropTarget = screen.getByTestId("sheet-body").parentElement!;

    fireEvent.dragEnter(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });
    expect(
      screen.getByTestId("attachment-dropzone-highlight"),
    ).toBeInTheDocument();

    fireEvent.dragLeave(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });

    expect(
      screen.queryByTestId("attachment-dropzone-highlight"),
    ).not.toBeInTheDocument();
  });

  it("test_AS_501_disabled_dropzone_ignores_a_drop_and_shows_no_highlight", () => {
    const onFilesDropped = vi.fn();
    const file = new File(["a"], "a.png", { type: "image/png" });

    render(
      createElement(
        AttachmentDropzone,
        { onFilesDropped, disabled: true },
        createElement("div", { "data-testid": "sheet-body" }, "content"),
      ),
    );

    const dropTarget = screen.getByTestId("sheet-body").parentElement!;

    fireEvent.dragEnter(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });
    expect(
      screen.queryByTestId("attachment-dropzone-highlight"),
    ).not.toBeInTheDocument();

    fireEvent.drop(dropTarget, {
      dataTransfer: makeFileDataTransfer([file]),
    });
    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it("test_window_level_guard_prevents_default_on_a_stray_drop_outside_the_dropzone", () => {
    const onFilesDropped = vi.fn();

    render(
      createElement(
        AttachmentDropzone,
        { onFilesDropped },
        createElement("div", { "data-testid": "sheet-body" }, "content"),
      ),
    );

    const strayDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(strayDropEvent, "preventDefault");

    window.dispatchEvent(strayDropEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
