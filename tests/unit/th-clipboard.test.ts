// @vitest-environment jsdom
//
// F093 (TH-270..TH-275) — copy-out wraps the block's content in its
// original tag and copies it to the clipboard.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyToClipboard, wrapForCopy } from "@/lib/code-editor/clipboard";

describe("F093 wrapForCopy", () => {
  it("TH-270: wraps style block content in <style> tags", () => {
    const wrapped = wrapForCopy({ type: "style" }, "body { color: red; }");
    expect(wrapped).toContain("<style>");
    expect(wrapped).toContain("</style>");
    expect(wrapped).toContain("body { color: red; }");
  });

  it("TH-271: wraps script block content in <script> tags", () => {
    const wrapped = wrapForCopy({ type: "script" }, "console.log('hi')");
    expect(wrapped).toContain("<script>");
    expect(wrapped).toContain("</script>");
    expect(wrapped).toContain("console.log('hi')");
  });
});

describe("F093 copyToClipboard", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.assign(navigator, {
      clipboard: { writeText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TH-272: writes the given content to the clipboard on success", async () => {
    writeText.mockResolvedValueOnce(undefined);
    await copyToClipboard("<style>body{}</style>");
    expect(writeText).toHaveBeenCalledWith("<style>body{}</style>");
  });

  it("TH-273: rejects when the clipboard API rejects, so callers can show a failure message", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await expect(copyToClipboard("x")).rejects.toThrow("denied");
  });
});
