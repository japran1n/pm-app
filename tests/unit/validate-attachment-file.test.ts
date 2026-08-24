// F259 (AS-504, AS-507): pure client-side pre-flight validation, run
// before any upload Server Action call is made.
import { describe, expect, it } from "vitest";

import { validateAttachmentFile } from "@/lib/tasks/validate-attachment-file";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/validation/attachments";

describe("validateAttachmentFile (F259: AS-507)", () => {
  it("test_AS_507_accepts_a_reasonably_sized_allowed_mime_type_file", () => {
    const result = validateAttachmentFile({
      size: 1024,
      type: "image/png",
      name: "photo.png",
    });
    expect(result.ok).toBe(true);
  });

  it("test_AS_507_rejects_an_oversized_file_with_a_clear_reason_before_upload", () => {
    const result = validateAttachmentFile({
      size: MAX_ATTACHMENT_SIZE_BYTES + 1,
      type: "image/png",
      name: "huge.png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/smaller/i);
  });

  it("test_AS_507_rejects_a_disallowed_mime_type_with_a_clear_reason_before_upload", () => {
    const result = validateAttachmentFile({
      size: 100,
      type: "application/x-sh",
      name: "script.sh",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not allowed/i);
  });

  it("test_AS_507_rejects_an_empty_file", () => {
    const result = validateAttachmentFile({
      size: 0,
      type: "image/png",
      name: "empty.png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/empty/i);
  });
});
