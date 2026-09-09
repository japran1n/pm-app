// @vitest-environment jsdom
//
// F011 (F033 fixes B1): behavioural tests for the tool call card
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
// - AS-105 / AS-041: a failed tool still renders (never a silent gap)
//   with an error summary and — when expanded — the sanitised error
//   detail.
//
// M2-SCRUTINY.md B1: every "done"/"failed" fixture below is built from
// tests/helpers/f033-tool-result-fixtures.ts, which derives its
// summary/detail/args strings by calling the ROUTE's own
// lib/ai/tool-result-display.ts functions against real `ToolResult`
// envelopes — never hand-invented strings the route cannot actually
// produce. That shared fixture module is imported by both this file and
// tests/integration/f007-docs-agent-route.test.ts, so the two can never
// drift apart again.

import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolCallCard, ToolCallList } from "@/components/ai/tool-call-card";
import type { ToolCallView } from "@/lib/ai/use-doc-assistant";
import {
  SEARCH_DOCS_ARGS_SUMMARY,
  SEARCH_DOCS_OK_DESCRIPTION,
  TOOL_ERROR_DETAIL,
  TOOL_ERROR_SUMMARY,
  getCurrentDocDoneToolCall,
  searchDocsDoneToolCall,
  searchDocsRunningToolCall,
  toolThrewFailedToolCall,
} from "../helpers/f033-tool-result-fixtures";

afterEach(() => {
  cleanup();
});

function runningCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return searchDocsRunningToolCall(overrides);
}

function doneCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return searchDocsDoneToolCall(overrides);
}

function failedCall(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return toolThrewFailedToolCall(overrides);
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
    // Real route output for a 3-result search (see F033 spec's example),
    // not a fabricated string.
    expect(SEARCH_DOCS_OK_DESCRIPTION.summary).toBe("3 docs");
    expect(screen.getByText("3 docs")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-card-detail")).not.toBeInTheDocument();
  });

  it("expands to show the result detail (and the argument summary) when the trigger is activated", () => {
    render(<ToolCallCard toolCall={doneCall()} />);
    const trigger = screen.getByTestId("tool-call-card-trigger");
    fireEvent.click(trigger);
    expect(screen.getByTestId("tool-call-card-detail")).toHaveTextContent(
      "onboarding.md, setup.md, faq.md",
    );
    expect(screen.getByTestId("tool-call-card-args")).toHaveTextContent(
      SEARCH_DOCS_ARGS_SUMMARY,
    );
  });

  it("also becomes expandable for a tool result with no matching-array detail (get_current_doc)", () => {
    render(<ToolCallCard toolCall={getCurrentDocDoneToolCall()} />);
    expect(screen.getByText("1,240 words")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tool-call-card-trigger"));
    expect(screen.getByTestId("tool-call-card-detail")).toHaveTextContent(
      "Onboarding Guide",
    );
  });
});

describe("F011: failed tool calls are never a silent gap", () => {
  it("renders a failed tool call in the same card type with an error summary", () => {
    render(<ToolCallCard toolCall={failedCall()} />);
    expect(screen.getByText("get_current_doc")).toBeInTheDocument();
    expect(screen.getByText(TOOL_ERROR_SUMMARY)).toBeInTheDocument();
    expect(screen.getByTestId("tool-call-card")).toHaveAttribute(
      "data-failed",
      "true",
    );
  });

  it("shows the sanitised error detail as plain text once expanded", () => {
    render(<ToolCallCard toolCall={failedCall()} />);
    fireEvent.click(screen.getByTestId("tool-call-card-trigger"));
    const detail = screen.getByTestId("tool-call-card-detail");
    expect(detail).toHaveTextContent(TOOL_ERROR_DETAIL);
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

  it("is marked non-actionable (but stays focusable) when there is no result detail or argument summary yet", () => {
    // The underlying base-ui Collapsible.Trigger keeps a disabled control
    // in the tab order and communicates state via aria-disabled rather
    // than the native `disabled` attribute (which would remove it from
    // the tab order entirely) — this is the correct accessible pattern,
    // not a bug: AS-069 requires reachability, and a card with nothing
    // to expand should still be announced as such, not silently skipped.
    render(<ToolCallCard toolCall={runningCall({ args: undefined })} />);
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
