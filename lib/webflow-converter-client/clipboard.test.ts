// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeToClipboard } from "./clipboard";

describe("writeToClipboard", () => {
  let clipboardData: Record<string, string>;
  let handler: ((e: ClipboardEvent) => void) | null;

  beforeEach(() => {
    clipboardData = {};
    handler = null;

    // Capture the copy event handler
    vi.spyOn(document, "addEventListener").mockImplementation((event, h) => {
      if (event === "copy") handler = h as (e: ClipboardEvent) => void;
    });
    vi.spyOn(document, "removeEventListener").mockImplementation(() => {});
    if (!("execCommand" in document)) {
      (document as unknown as { execCommand: unknown }).execCommand = () =>
        false;
    }
    vi.spyOn(document, "execCommand").mockImplementation((cmd) => {
      if (cmd === "copy" && handler) {
        const mockEvent = {
          preventDefault: vi.fn(),
          clipboardData: {
            setData: (mime: string, data: string) => {
              clipboardData[mime] = data;
            },
          },
        } as unknown as ClipboardEvent;
        handler(mockEvent);
        return true;
      }
      return false;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("AS-031: writes application/json to clipboard", () => {
    const payload = '{"type":"@webflow/XscpData"}';
    writeToClipboard([{ mimeType: "application/json", data: payload }]);
    expect(clipboardData["application/json"]).toBe(payload);
  });

  it("AS-032: writes text/plain to clipboard", () => {
    writeToClipboard([{ mimeType: "text/plain", data: "hello" }]);
    expect(clipboardData["text/plain"]).toBe("hello");
  });

  it("writes multiple MIME types in one call", () => {
    writeToClipboard([
      { mimeType: "application/json", data: "{}" },
      { mimeType: "text/plain", data: "fallback" },
    ]);
    expect(clipboardData["application/json"]).toBe("{}");
    expect(clipboardData["text/plain"]).toBe("fallback");
  });

  it("returns false when execCommand fails", () => {
    document.execCommand = vi.fn().mockReturnValue(false);
    const result = writeToClipboard([{ mimeType: "text/plain", data: "x" }]);
    expect(result).toBe(false);
  });
});
