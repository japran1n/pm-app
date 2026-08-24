// F258 (AS-503): pure orchestration for uploading multiple dropped/selected
// files without firing them all as one unbounded batch of parallel network
// calls. Extracted as a DOM/React-free function (same "pure logic lives
// outside the component" convention as lib/tasks/append-attachment.ts and
// lib/tasks/reconcile-realtime-comment.ts) so the concurrency-cap behaviour
// is unit-testable without jsdom or a real upload action.
//
// Runs `upload(file)` for every file in `files`, but never lets more than
// `concurrency` calls be in flight at once — e.g. dropping 10 files does not
// open 10 parallel requests. Every file is still attempted regardless of
// earlier failures (one bad file in a multi-file drop must not block the
// rest — AS-503 says "all uploaded", not "all-or-nothing"), and results are
// returned in the same order as `files` was given, not completion order, so
// callers can zip failures back to the file that caused them.
export async function uploadFilesWithConcurrency<TFile, TResult>(
  files: TFile[],
  upload: (file: TFile) => Promise<TResult>,
  concurrency = 3,
): Promise<TResult[]> {
  const results: TResult[] = new Array(files.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < files.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await upload(files[currentIndex]);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, files.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
