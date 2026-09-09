// @vitest-environment jsdom
//
// F010: behavioural tests for the assistant thread renderer
// (components/ai/assistant-thread.tsx).
//
// Covers:
// - AS-062: assistant text renders progressively as `text` events arrive
//   (i.e. as a streamed message's `text` prop grows across re-renders),
//   not only once streaming finishes.
// - AS-069: every interactive element in the thread (the "jump to latest"
//   affordance) is reachable by keyboard and has a visible focus state.
// - Bubble/plain-text role distinction: user turns get a bubble
//   container, assistant turns render as plain text with no bubble.
// - Considerate auto-scroll: sticks to bottom while already near it;
//   does not fight a user who has scrolled up (shows "jump to latest"
//   instead of yanking the view back down).

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssistantThread } from "@/components/ai/assistant-thread";
import type { AssistantMessage } from "@/lib/ai/use-doc-assistant";

afterEach(() => {
  cleanup();
});

/**
 * jsdom does not implement layout, so `scrollHeight`/`clientHeight`/
 * `scrollTop` are always 0 unless a test overrides them. This helper
 * stubs the scroll container's geometry on the DOM node the ref attaches
 * to, so `useStickToBottom`'s distance-from-bottom math is meaningful in
 * a jsdom test rather than trivially always "at the bottom".
 */
function stubScrollGeometry(
  el: HTMLElement,
  { scrollTop, scrollHeight, clientHeight }: { scrollTop: number; scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v) => {
      scrollTop = v;
    },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
}

function makeMessages(overrides: Partial<AssistantMessage>[] = []): AssistantMessage[] {
  const base: AssistantMessage[] = [
    { id: "u1", role: "user", text: "How do I set up onboarding?" },
    { id: "a1", role: "assistant", text: "Start with the **Onboarding** doc." },
  ];
  return overrides.length ? (overrides as AssistantMessage[]) : base;
}

describe("F010: user vs assistant turn rendering", () => {
  it("renders user turns in a bubble, right-aligned", () => {
    render(<AssistantThread messages={makeMessages()} />);
    const bubble = screen.getByTestId("assistant-thread-user-bubble");
    expect(bubble).toHaveTextContent("How do I set up onboarding?");
    // Bubble treatment: rounded + a background fill class distinguishing
    // it from the plain-ground assistant text.
    expect(bubble.className).toMatch(/rounded/);
    expect(bubble.className).toMatch(/bg-/);
    // Right-aligned container.
    expect(bubble.parentElement?.className).toMatch(/justify-end/);
  });

  it("renders assistant turns as plain text with no bubble wrapper", () => {
    render(<AssistantThread messages={makeMessages()} />);
    const turn = screen.getByTestId("assistant-thread-assistant-turn");
    expect(turn).toBeInTheDocument();
    // No bubble background/rounding classes on the assistant turn's own
    // container — it sits directly on the panel ground.
    expect(turn.className).not.toMatch(/bg-muted/);
    expect(turn.className).not.toMatch(/rounded-lg/);
  });
});

describe("F010 AS-062: assistant text renders progressively", () => {
  it("reflects a growing streamed message's text across re-renders, not only at the end", () => {
    const { rerender } = render(
      <AssistantThread
        messages={[{ id: "a1", role: "assistant", text: "Sure" }]}
      />,
    );
    expect(screen.getByTestId("assistant-thread-assistant-turn")).toHaveTextContent("Sure");

    rerender(
      <AssistantThread
        messages={[{ id: "a1", role: "assistant", text: "Sure, here is how." }]}
      />,
    );
    expect(screen.getByTestId("assistant-thread-assistant-turn")).toHaveTextContent(
      "Sure, here is how.",
    );
  });
});

describe("F010: aria-live thread container", () => {
  it("uses aria-live='polite', not 'assertive'", () => {
    render(<AssistantThread messages={makeMessages()} />);
    const thread = screen.getByTestId("assistant-thread");
    expect(thread).toHaveAttribute("aria-live", "polite");
  });
});

describe("F010: considerate auto-scroll", () => {
  it("does not show 'jump to latest' while the user is already near the bottom", () => {
    render(<AssistantThread messages={makeMessages()} />);
    const container = screen.getByTestId("assistant-thread");
    stubScrollGeometry(container, { scrollTop: 460, scrollHeight: 500, clientHeight: 40 });
    act(() => {
      fireEvent.scroll(container);
    });
    expect(
      screen.queryByTestId("assistant-thread-jump-to-latest"),
    ).not.toBeInTheDocument();
  });

  it("shows 'jump to latest' once the user scrolls away from the bottom, and does not auto-scroll them back on new content", () => {
    render(<AssistantThread messages={makeMessages()} />);
    const container = screen.getByTestId("assistant-thread");
    // Far from the bottom (well past the ~40px stick threshold).
    stubScrollGeometry(container, { scrollTop: 0, scrollHeight: 500, clientHeight: 40 });
    act(() => {
      fireEvent.scroll(container);
    });

    expect(screen.getByTestId("assistant-thread-jump-to-latest")).toBeInTheDocument();
    // Scroll position was not forced back to the bottom by the component.
    expect(container.scrollTop).toBe(0);
  });

  it("'jump to latest' is a real, keyboard-focusable button (AS-069) and scrolls to the bottom on activation", () => {
    render(<AssistantThread messages={makeMessages()} />);
    const container = screen.getByTestId("assistant-thread");
    stubScrollGeometry(container, { scrollTop: 0, scrollHeight: 500, clientHeight: 40 });
    act(() => {
      fireEvent.scroll(container);
    });

    const jumpButton = screen.getByTestId("assistant-thread-jump-to-latest");
    expect(jumpButton.tagName).toBe("BUTTON");
    // A native <button> is keyboard-reachable (tab order) by default and
    // is not explicitly removed from it.
    expect(jumpButton).not.toHaveAttribute("tabindex", "-1");
    // Visible focus state: focus-visible ring classes, not `outline-none`
    // with nothing replacing it.
    expect(jumpButton.className).toMatch(/focus-visible:ring/);

    fireEvent.click(jumpButton);
    expect(container.scrollTop).toBe(container.scrollHeight);
    expect(
      screen.queryByTestId("assistant-thread-jump-to-latest"),
    ).not.toBeInTheDocument();
  });
});
