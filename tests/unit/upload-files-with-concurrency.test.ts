// F258 (AS-503): unit test for the pure concurrency-capped upload
// orchestrator (lib/tasks/upload-files-with-concurrency.ts).
//
//   AS-503: multiple files dropped at once are all uploaded.
//
// This is where the "not 10 parallel requests" half of AS-503's Draft
// scope note is actually asserted — a DOM-free test on the pure function,
// mirroring the append-attachment.test.ts convention of testing extracted
// logic directly rather than only through a rendered component.

import { describe, expect, it, vi } from "vitest";

import { uploadFilesWithConcurrency } from "@/lib/tasks/upload-files-with-concurrency";

describe("uploadFilesWithConcurrency (F258: AS-503)", () => {
  it("test_AS_503_every_file_is_uploaded", async () => {
    const files = ["a.png", "b.png", "c.png", "d.png"];
    const upload = vi.fn(async (file: string) => `uploaded:${file}`);

    const results = await uploadFilesWithConcurrency(files, upload, 2);

    expect(upload).toHaveBeenCalledTimes(4);
    expect(results).toEqual([
      "uploaded:a.png",
      "uploaded:b.png",
      "uploaded:c.png",
      "uploaded:d.png",
    ]);
  });

  it("test_AS_503_never_exceeds_the_concurrency_cap", async () => {
    const files = Array.from({ length: 10 }, (_, i) => `file-${i}`);
    let inFlight = 0;
    let maxInFlight = 0;

    const upload = vi.fn(async (file: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield a tick so overlapping calls actually have a chance to race.
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return file;
    });

    await uploadFilesWithConcurrency(files, upload, 3);

    expect(upload).toHaveBeenCalledTimes(10);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("test_AS_503_one_failing_file_does_not_stop_the_rest_from_uploading", async () => {
    const files = ["good1", "bad", "good2"];
    const upload = vi.fn(async (file: string) => {
      if (file === "bad") {
        return { ok: false, error: "boom" };
      }
      return { ok: true, error: null };
    });

    const results = await uploadFilesWithConcurrency(files, upload, 3);

    expect(upload).toHaveBeenCalledTimes(3);
    expect(results[0]).toEqual({ ok: true, error: null });
    expect(results[1]).toEqual({ ok: false, error: "boom" });
    expect(results[2]).toEqual({ ok: true, error: null });
  });

  it("test_AS_503_empty_file_list_uploads_nothing", async () => {
    const upload = vi.fn(async (file: string) => file);

    const results = await uploadFilesWithConcurrency([], upload, 3);

    expect(upload).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
