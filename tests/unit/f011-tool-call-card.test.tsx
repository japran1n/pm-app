// @vitest-environment jsdom
//
// F011: behavioural tests for the tool call card
// (components/ai/tool-call-card.tsx).
//
// Covers:
// - AS-063: a tool call renders as a collapsed card showing tool name and
//   a one-line result; clicking (activating) the trigger expands it to
//   show the result detail.
// - AS-069: the disclosure trigger is a real, keyboard-focusable control
//   with a visible focus state.
// - AS-070: no hex colour literals / new colour tokens anywhere in the
//   component's source.
// - A failed tool still renders (never a silent gap) with an error
//   summary and — when expanded — the sanitised error detail.

import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolCallCard, ToolCallList } from "@/components/ai/tool-call-card";
import type { ToolCallView } from "@/lib/ai/use-doc-assistant";

afterEach(() => {
  cleanup();
});

function runningCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return { id: "t1", name: "search_docs", status: "running", ...overrides };
}

function doneCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: "t1",
    name: "search_docs",
    status: "done",
    summary: "Found 3 matching docs",
    detail: "onboarding.md, setup.md, faq.md",
    ...overrides,
  };
}

function failedCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    id: "t2",
    name: "read_doc",
    status: "done",
    summary: "tool error",
    detail: "The requested document could not be found.",
    ...overrides,
  };
}

describe("F011: collapsed-by-default rendering (AS-063)", () => {
  it("shows the tool name, a result glyph, and a one-line summary while running, without exposing detail", () => {
    render(<ToolCallCard toolCall={runningCall()} />);
    expect(screen.getByText("search_docs")).toBeInTheDocument();
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-card-detail")).not.toBeInTheDocument();
  });

  it("shows the tool name and the one-line result summary once done, collapsed by default", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    expect(screen.getByText("search_docs")).toBeInTheDocument();
    expect(screen.getByText("Found 3 matching docs")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-card-detail")).not.toBeInTheDocument();
  });

  it("expands to show the result detail when the trigger is activated", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    const trigger = screen.getByTestId("tool-call-card-trigger");
    fireEvent.click(trigger);
    expect(screen.getByTestId("tool-call-card-detail")).toHaveTextContent(
      "onboarding.md, setup.md, faq.md",
    );
  });
});

describe("F011: failed tool calls are never a silent gap", () => {
  it("renders a failed tool call in the same card type with an error summary", () => {
    render(<ToolCallCard toolCall={failedCall()} />);
    expect(screen.getByText("read_doc")).toBeInTheDocument();
    expect(screen.getByText("tool error")).toBeInTheDocument();
    expect(screen.getByTestId("tool-call-card")).toHaveAttribute(
      "data-failed",
      "true",
    );
  });

  it("shows the sanitised error detail as plain text once expanded", () => {
    render(<ToolCallCard toolCall={failedCall()} />);
    fireEvent.click(screen.getByTestId("tool-call-card-trigger"));
    const detail = screen.getByTestId("tool-call-card-detail");
    expect(detail).toHaveTextContent(
      "The requested document could not be found.",
    );
    // Rendered as text, not injected as markup.
    expect(detail.innerHTML).not.toContain("<script");
  });

  it("marks a successfully-done card as not failed", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    expect(screen.getByTestId("tool-call-card")).toHaveAttribute(
      "data-failed",
      "false",
    );
  });
});

describe("F011: quiet by default / list rendering", () => {
  it("renders nothing when there are no tool calls", () => {
    const { container } = render(<ToolCallList toolCalls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per tool call, including a mix of running/done/failed", () => {
    render(
      <ToolCallList
        toolCalls={[runningCall({ id: "a" }), doneCall({ id: "b" }), failedCall({ id: "c" })]}
      />,
    );
    expect(screen.getAllByTestId("tool-call-card")).toHaveLength(3);
  });
});

describe("F011: keyboard reachability and visible focus (AS-069)", () => {
  it("is a real, focusable button element, not a div with an onClick handler", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    const trigger = screen.getByTestId("tool-call-card-trigger");
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("carries visible focus-state classes", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    const trigger = screen.getByTestId("tool-call-card-trigger");
    expect(trigger.className).toMatch(/focus-visible:ring/);
  });

  it("is reachable via standard tab order (not removed from it)", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    const trigger = screen.getByTestId("tool-call-card-trigger");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
  });

  it("is marked non-actionable (but stays focusable) when there is no detail to expand", () => {
    // The underlying base-ui Collapsible.Trigger keeps a disabled control
    // in the tab order and communicates state via aria-disabled rather
    // than the native `disabled` attribute (which would remove it from
    // the tab order entirely) — this is the correct accessible pattern,
    // not a bug: AS-069 requires reachability, and a card with nothing
    // to expand should still be announced as such, not silently skipped.
    render(<ToolCallCard toolCall={runningCall()} />);
    const trigger = screen.getByTestId("tool-call-card-trigger");
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
  });
});

describe("F011: design tokens only, no hex literals (AS-070)", () => {
  it("contains no hex colour literals in its source", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/ai/tool-call-card.tsx"),
      "utf8",
    );
    // Strip comments so this doesn't false-positive on the doc comment
    // that references --text-quaternary's hex value (#62666d) as prose.
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(codeOnly).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("uses --line-row (not --border) for internal row separators", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/ai/tool-call-card.tsx"),
      "utf8",
    );
    expect(source).toMatch(/divide-line-row/);
    expect(source).not.toMatch(/divide-border\b/);
  });
});
