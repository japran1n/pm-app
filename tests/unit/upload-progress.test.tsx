// @vitest-environment jsdom
//
// F259 (AS-504, AS-507): UploadProgress renders one row per file with an
// indeterminate ("uploading" -> spinner) state, settling to a
// success/error icon, and a rejected-before-upload row shows its reason.
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  UploadProgress,
  type UploadProgressJob,
} from "@/components/task/upload-progress";

afterEach(() => {
  cleanup();
});

describe("UploadProgress (F259: AS-504, AS-507)", () => {
  it("test_AS_504_renders_one_row_per_file_with_its_name_and_size", () => {
    const jobs: UploadProgressJob[] = [
      { id: "1", fileName: "a.png", fileSize: 2048, status: "uploading" },
      { id: "2", fileName: "b.pdf", fileSize: 4096, status: "success" },
    ];

    render(
      createElement(UploadProgress, {
        jobs,
        onCancel: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );

    const rows = screen.getAllByTestId("upload-progress-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });

  it("test_AS_504_an_uploading_row_is_indeterminate_not_a_fabricated_percentage", () => {
    const jobs: UploadProgressJob[] = [
      { id: "1", fileName: "a.png", fileSize: 2048, status: "uploading" },
    ];

    render(
      createElement(UploadProgress, {
        jobs,
        onCancel: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );

    const row = screen.getByTestId("upload-progress-row");
    expect(row).toHaveAttribute("data-status", "uploading");
    // No "%" anywhere in the row — this feature deliberately does not
    // fabricate a byte-level percentage the transport cannot report.
    expect(row.textContent).not.toContain("%");
  });

  it("test_AS_507_a_rejected_row_shows_the_reason_it_was_rejected", () => {
    const jobs: UploadProgressJob[] = [
      {
        id: "1",
        fileName: "huge.png",
        fileSize: 999,
        status: "rejected",
        reason: "File must be 10MB or smaller.",
      },
    ];

    render(
      createElement(UploadProgress, {
        jobs,
        onCancel: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );

    expect(screen.getByText("File must be 10MB or smaller.")).toBeInTheDocument();
  });

  it("test_AS_507_an_error_row_shows_the_server_reason_it_failed", () => {
    const jobs: UploadProgressJob[] = [
      {
        id: "1",
        fileName: "a.png",
        fileSize: 999,
        status: "error",
        reason: "Something went wrong. Please try again in a moment.",
      },
    ];

    render(
      createElement(UploadProgress, {
        jobs,
        onCancel: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );

    expect(
      screen.getByText("Something went wrong. Please try again in a moment."),
    ).toBeInTheDocument();
  });

  it("test_AS_504_cancel_button_on_an_uploading_row_calls_onCancel", () => {
    const onCancel = vi.fn();
    const jobs: UploadProgressJob[] = [
      { id: "job-1", fileName: "a.png", fileSize: 2048, status: "uploading" },
    ];

    render(
      createElement(UploadProgress, {
        jobs,
        onCancel,
        onDismiss: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel a.png" }));
    expect(onCancel).toHaveBeenCalledWith("job-1");
  });

  it("test_AS_504_dismiss_button_on_a_settled_row_calls_onDismiss", () => {
    const onDismiss = vi.fn();
    const jobs: UploadProgressJob[] = [
      { id: "job-2", fileName: "b.png", fileSize: 2048, status: "success" },
    ];

    render(
      createElement(UploadProgress, {
        jobs,
        onCancel: vi.fn(),
        onDismiss,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss b.png" }));
    expect(onDismiss).toHaveBeenCalledWith("job-2");
  });

  it("renders nothing when there are no jobs", () => {
    render(
      createElement(UploadProgress, {
        jobs: [],
        onCancel: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );
    expect(screen.queryByTestId("upload-progress-list")).not.toBeInTheDocument();
  });
});
