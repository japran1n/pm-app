// SEC-CONTENT-08 / REUSE-PORTAL-05: the portal deliverable pre-flight check
// is the same rule deliverPortalDeliverable enforces server-side.
import { describe, expect, it } from "vitest";

import {
  validateAttachmentFile,
  validateDeliverableFile,
} from "@/lib/tasks/validate-attachment-file";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/validation/attachments";

describe("validateDeliverableFile", () => {
  it("is the attachment rule the server enforces", () => {
    expect(validateDeliverableFile).toBe(validateAttachmentFile);
  });

  it("rejects files the server would reject", () => {
    const big = { name: "a.pdf", type: "application/pdf", size: MAX_ATTACHMENT_SIZE_BYTES + 1 };
    expect(validateDeliverableFile(big).ok).toBe(false);
    expect(validateDeliverableFile({ name: "a.zip", type: "application/zip", size: 10 }).ok).toBe(false);
    expect(
      validateDeliverableFile({ name: "a.fig", type: "application/octet-stream", size: 10 }).ok,
    ).toBe(false);
  });

  it("accepts a file within the server rule", () => {
    expect(validateDeliverableFile({ name: "a.pdf", type: "application/pdf", size: 10 }).ok).toBe(true);
  });
});
