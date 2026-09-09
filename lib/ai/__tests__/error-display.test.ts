// F020: unit tests for lib/ai/error-display.ts's error-code -> display
// mapping used by components/ai/assistant-sidebar.tsx.

import { describe, expect, it } from "vitest";

import { getErrorDisplay } from "@/lib/ai/error-display";

describe("F020 getErrorDisplay", () => {
  it("renders no_api_key with neutral (non-warning) tone — it is a configuration state, not a failure", () => {
    const display = getErrorDisplay({ code: "no_api_key", message: "The AI assistant is not configured yet." });
    expect(display.tone).toBe("neutral");
    expect(display.message).toBe("The AI assistant is not configured yet.");
  });

  it("renders rate_limit with warning tone", () => {
    const display = getErrorDisplay({ code: "rate_limit", message: "Too many requests, please wait 30 seconds." });
    expect(display.tone).toBe("warning");
    expect(display.message).toContain("Too many requests");
  });

  it("renders thread_limit with a new-chat suggestion, warning tone", () => {
    const display = getErrorDisplay({
      code: "thread_limit",
      message: "This conversation has reached its context limit. Start a new chat to continue.",
    });
    expect(display.tone).toBe("warning");
    expect(display.message).toMatch(/new chat/i);
  });

  it("renders auth_error suggesting the user sign in again, warning tone", () => {
    const display = getErrorDisplay({ code: "auth_error", message: "Please sign in again." });
    expect(display.tone).toBe("warning");
    expect(display.message).toBe("Please sign in again.");
  });

  it("renders model_error suggesting the user try again, warning tone", () => {
    const display = getErrorDisplay({ code: "model_error", message: "Something went wrong. Please try again." });
    expect(display.tone).toBe("warning");
  });

  it("falls back to a generic message for an unknown code, never rendering blank or raw", () => {
    const display = getErrorDisplay({ code: "totally_unknown_code", message: "" });
    expect(display.tone).toBe("warning");
    expect(display.message.length).toBeGreaterThan(0);
    expect(display.message).not.toBe("");
  });
});
