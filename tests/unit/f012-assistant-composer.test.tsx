// @vitest-environment jsdom
//
// F012: behavioural tests for the docs assistant composer
// (components/ai/assistant-composer.tsx).
//
// Covers:
// - AS-067: an in-flight turn shows a stop control; pressing it calls
//   the hook's `stop()`.
// - AS-069: the composer's interactive elements (input, send/stop
//   controls) are real, keyboard-focusable elements with a visible
//   focus state.
// - AS-071: with no API key configured, the composer is disabled and
//   shows exactly one explanatory, non-destructive message.

import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantComposer } from "@/components/ai/assistant-composer";

afterEach(() => {
  cleanup();
});

describe("AS-067: stop control while streaming", () => {
  it("makes the input read-only (without dropping focus) and replaces send with a Stop control wired to stop()", () => {
    const send = vi.fn();
    const stop = vi.fn();
    render(
      <AssistantComposer hasApiKey isStreaming send={send} stop={stop} />,
    );

    const input = screen.getByTestId("assistant-composer-input");
    // F036 (fixes B6-adjacent minor): `disabled` used to drop focus to
    // `<body>` on every turn, forcing keyboard users to re-tab to reach
    // Stop. `readOnly` blocks edits without making the element
    // unfocusable — assert that specifically, not `toBeDisabled()`.
    expect(input).toHaveAttribute("readonly");
    expect(input).not.toBeDisabled();
    expect(screen.queryByTestId("assistant-composer-send")).not.toBeInTheDocument();

    const stopButton = screen.getByTestId("assistant-composer-stop");
    expect(stopButton).toBeInTheDocument();
    fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the send control (not Stop) and an enabled input when not streaming", () => {
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
      />,
    );

    expect(screen.getByTestId("assistant-composer-input")).not.toBeDisabled();
    expect(screen.getByTestId("assistant-composer-send")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-composer-stop")).not.toBeInTheDocument();
  });
});

describe("AS-069: keyboard reachability and visible focus", () => {
  it("the stop control is a real, focusable button with visible-focus classes", () => {
    render(
      <AssistantComposer hasApiKey isStreaming send={vi.fn()} stop={vi.fn()} />,
    );
    const stopButton = screen.getByTestId("assistant-composer-stop");
    expect(stopButton.tagName).toBe("BUTTON");
    expect(stopButton).not.toHaveAttribute("tabindex", "-1");
    expect(stopButton.className).toMatch(/focus-visible:ring/);
  });

  it("the send control is a real, focusable button with visible-focus classes and standard tab order", () => {
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
      />,
    );
    const sendButton = screen.getByTestId("assistant-composer-send");
    expect(sendButton.tagName).toBe("BUTTON");
    expect(sendButton).not.toHaveAttribute("tabindex", "-1");
    expect(sendButton.className).toMatch(/focus-visible:ring/);
  });

  it("the textarea input itself carries visible-focus classes and is not removed from tab order", () => {
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
      />,
    );
    const input = screen.getByTestId("assistant-composer-input");
    expect(input).not.toHaveAttribute("tabindex", "-1");
    expect(input.className).toMatch(/focus-visible:ring/);
  });

  it("Enter submits and Shift+Enter does not (matches components/chat/message-composer.tsx's single convention)", () => {
    const send = vi.fn();
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={send}
        stop={vi.fn()}
      />,
    );
    const input = screen.getByTestId("assistant-composer-input") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(send).toHaveBeenCalledWith("hello");
  });

  it("F037: an IME candidate-commit Enter (isComposing) does not submit", () => {
    const send = vi.fn();
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={send}
        stop={vi.fn()}
      />,
    );
    const input = screen.getByTestId("assistant-composer-input") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "こんにちは" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(send).not.toHaveBeenCalled();
    expect(input.value).toBe("こんにちは");

    // Once composition has ended, a real Enter still submits.
    fireEvent.keyDown(input, { key: "Enter", isComposing: false });
    expect(send).toHaveBeenCalledWith("こんにちは");
  });

  it("F037: an IME candidate-commit Enter (keyCode 229, Safari/older-Chrome fallback) does not submit", () => {
    const send = vi.fn();
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={send}
        stop={vi.fn()}
      />,
    );
    const input = screen.getByTestId("assistant-composer-input") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "candidate" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not submit an empty or whitespace-only message", () => {
    const send = vi.fn();
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={send}
        stop={vi.fn()}
      />,
    );
    const input = screen.getByTestId("assistant-composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();

    const sendButton = screen.getByTestId("assistant-composer-send");
    expect(sendButton).toBeDisabled();
  });
});

describe("AS-071: no API key configured", () => {
  it("shows one explanatory message, disabled, with no destructive/error styling", () => {
    render(
      <AssistantComposer
        hasApiKey={false}
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("assistant-composer-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-composer-send")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assistant-composer-stop")).not.toBeInTheDocument();

    const notice = screen.getByTestId("assistant-composer-no-api-key");
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/isn.t configured/i);
    expect(notice.className).not.toMatch(/destructive/);
  });
});

describe("meta row", () => {
  it("shows the model name beneath the input when enabled", () => {
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
      />,
    );
    expect(screen.getByTestId("assistant-composer-model")).toHaveTextContent(
      "Claude Opus 5",
    );
    expect(screen.queryByTestId("assistant-composer-usage")).not.toBeInTheDocument();
  });

  it("shows a running token count when usage is provided", () => {
    render(
      <AssistantComposer
        hasApiKey
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
        usage={{ inputTokens: 120, outputTokens: 340 }}
      />,
    );
    expect(screen.getByTestId("assistant-composer-usage")).toHaveTextContent(
      "460 tokens",
    );
  });

  it("does not render a meta row in the no-API-key state", () => {
    render(
      <AssistantComposer
        hasApiKey={false}
        isStreaming={false}
        send={vi.fn()}
        stop={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("assistant-composer-meta")).not.toBeInTheDocument();
  });
});

describe("static design-rule checks", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "components/ai/assistant-composer.tsx"),
    "utf8",
  );

  it("contains no hex colour literals", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("uses --line-row (not --border) for its internal separator", () => {
    expect(source).toMatch(/border-line-row/);
    expect(source).not.toMatch(/border-b?-?border\b.*separator/i);
  });

  it("takes no shadow classes", () => {
    expect(source).not.toMatch(/\bshadow-/);
  });

  it("does not introduce a bg-primary button (one-filled-button-per-screen rule)", () => {
    expect(source).not.toMatch(/bg-primary/);
  });
});
