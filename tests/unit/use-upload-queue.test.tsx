// @vitest-environment jsdom
// REUSE-UI-03: one upload-queue state machine for the attachment list and
// the comment composer; a rejected Server Action never leaves a row stuck.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { UPLOAD_FAILED_MESSAGE, useUploadQueue } from "@/lib/hooks/use-upload-queue";

const png = (name = "a.png") => new File(["x"], name, { type: "image/png" });

describe("useUploadQueue", () => {
  it("settles a rejected upload call as an error instead of 'uploading' forever", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("413"));
    const { result } = renderHook(() => useUploadQueue({ upload }));

    act(() => result.current.uploadFiles([png()]));

    await waitFor(() => expect(result.current.jobs[0]?.status).toBe("error"));
    expect(result.current.jobs[0]?.reason).toBe(UPLOAD_FAILED_MESSAGE);
  });

  it("marks success and calls onSuccess; rejects invalid files without uploading", async () => {
    const upload = vi.fn().mockResolvedValue({ ok: true, data: { fileName: "a.png" } });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useUploadQueue({ upload, onSuccess }));

    act(() =>
      result.current.uploadFiles([png(), new File(["x"], "b.exe", { type: "application/x-msdownload" })]),
    );

    await waitFor(() => expect(result.current.jobs[0]?.status).toBe("success"));
    expect(result.current.jobs[1]?.status).toBe("rejected");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.any(File), { fileName: "a.png" });
  });

  it("ignores the result of a cancelled job", async () => {
    let resolve!: (v: unknown) => void;
    const upload = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useUploadQueue({ upload, onSuccess }));

    act(() => result.current.uploadFiles([png()]));
    const jobId = result.current.jobs[0]!.id;
    act(() => result.current.cancel(jobId));
    await act(async () => resolve({ ok: true, data: {} }));

    expect(result.current.jobs).toHaveLength(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
