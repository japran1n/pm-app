// F334 (M17 scrutiny BLOCKER-3, security): every exported async function in
// a "use server" module is registered as a client-invocable Server Action
// endpoint, reachable by ID regardless of whether any UI calls it.
// lib/actions/attachments.ts used to export `uploadAttachmentForUser`,
// which trusted a caller-supplied `userId` as already-verified identity —
// any caller who could reach that action endpoint could act as an
// arbitrary user. This test asserts the module's export surface directly,
// so a future convenience re-export of a raw-userId-taking function can't
// silently reopen that hole.
import { describe, expect, it } from "vitest";

import * as attachmentsActions from "@/lib/actions/attachments";
import { uploadAttachmentForUser } from "@/lib/attachments/upload";

describe("F334: lib/actions/attachments.ts export surface", () => {
  it("AS-105/AS-108/AS-110/AS-111/AS-112/AS-113/AS-114: does not export any function taking a raw userId parameter", () => {
    // Every export from the "use server" module must be a function whose
    // FIRST parameter is never named/shaped like a trusted, caller-supplied
    // identity string. We can't introspect parameter names at runtime, so
    // instead assert the exact, closed set of exported *function* names —
    // any addition to this set must be reviewed against this test's intent.
    const exportedFunctionNames = Object.entries(attachmentsActions)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .sort();

    expect(exportedFunctionNames).toEqual(
      ["deleteAttachment", "getAttachmentSignedUrl", "uploadAttachment"].sort(),
    );

    // Specifically: the vulnerable function must not be reachable from this
    // module at all.
    expect(
      (attachmentsActions as Record<string, unknown>).uploadAttachmentForUser,
    ).toBeUndefined();
  });

  it("the shared upload implementation lives in a plain (non-Server-Action) module and is only reachable via direct import", () => {
    // Sanity check that the extraction target actually exists and is a
    // real function — this is the module the Route Handler and tests
    // import from directly instead of going through the Server Action
    // layer.
    expect(typeof uploadAttachmentForUser).toBe("function");
  });
});
