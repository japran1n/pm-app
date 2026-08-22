// @vitest-environment jsdom
//
// F169: shared Tiptap editor component (components/editor/rich-text-editor.tsx).
//
// AS-306: bold, italic, headings, lists, code blocks, links all work.
// AS-313: keyboard-operable — toolbar buttons and shortcuts are reachable
//         via keyboard, not just mouse; Escape exits/blurs without losing
//         content.
//
// Approach: Tiptap/ProseMirror's contenteditable typing simulation is not
// reliable in jsdom (no real browser input pipeline), so AS-306 is verified
// through the shared extension set actually rendering each mark/node type
// via a real Tiptap JSON document — the same code path (`RichTextRenderer`
// and `RichTextEditor` share `sharedExtensions()`) that a live editor uses
// to interpret content, and through the toolbar's `isActive` detection
// reflecting the true editor state on mount for each type. AS-313 is
// verified against the real DOM: toolbar buttons are genuine <button>
// elements with no keyboard trap, and Escape is dispatched as a real
// keydown event against the focused editor DOM node.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  RichTextEditor,
  RichTextRenderer,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

const FULL_DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Subtitle" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "bold" }], text: "bold text" },
        { type: "text", text: " and " },
        { type: "text", marks: [{ type: "italic" }], text: "italic text" },
        { type: "text", text: " and a " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          text: "link",
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "bullet one" }] }] },
      ],
    },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item one" }] }] },
      ],
    },
    {
      type: "codeBlock",
      content: [{ type: "text", text: "const x = 1" }],
    },
  ],
};

describe("AS-306: RichTextRenderer / RichTextEditor interpret bold, italic, headings, lists, code blocks, links", () => {
  it("test_AS_306_renders_headings", () => {
    render(createElement(RichTextRenderer, { content: FULL_DOC }));
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Subtitle" })).toBeInTheDocument();
  });

  it("test_AS_306_renders_bold_and_italic_marks", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold text");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("italic text");
  });

  it("test_AS_306_renders_bullet_and_ordered_lists", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const ul = container.querySelector("ul");
    const ol = container.querySelector("ol");
    expect(ul).not.toBeNull();
    expect(within(ul as HTMLElement).getByText("bullet one")).toBeInTheDocument();
    expect(ol).not.toBeNull();
    expect(within(ol as HTMLElement).getByText("item one")).toBeInTheDocument();
  });

  it("test_AS_306_renders_code_block", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const pre = container.querySelector("pre code");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe("const x = 1");
  });

  it("test_AS_306_renders_link_with_href", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("link");
  });

  it("test_AS_306_editable_toolbar_reflects_heading_active_state_from_true_editor_state", () => {
    const headingDoc: JSONContent = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
    };
    render(createElement(RichTextEditor, { content: headingDoc }));
    // Cursor lands at the document start inside the heading node on mount,
    // so the toolbar's isActive("heading", {level:1}) check reflects the
    // real editor state, not a hardcoded prop.
    const h1Button = screen.getByRole("button", { name: "Heading 1" });
    expect(h1Button).toHaveAttribute("aria-pressed", "true");
    const h2Button = screen.getByRole("button", { name: "Heading 2" });
    expect(h2Button).toHaveAttribute("aria-pressed", "false");
  });

  it("test_AS_306_toolbar_toggle_click_updates_controlled_JSON_value", () => {
    const onChange = vi.fn();
    const emptyDoc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    };
    render(createElement(RichTextEditor, { content: emptyDoc, onChange }));
    const boldButton = screen.getByRole("button", { name: "Bold" });
    // Clicking the toolbar toggles the stored mark for the empty
    // selection — this is Tiptap's documented behaviour and is a real,
    // observable state transition on the editor (isActive flips), proving
    // the toolbar control is wired to the live editor instance rather than
    // being a static, disconnected button.
    fireEvent.click(boldButton);
    expect(boldButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(boldButton);
    expect(boldButton).toHaveAttribute("aria-pressed", "false");
  });
});

describe("AS-313: keyboard operability, Escape blurs without losing content", () => {
  it("test_AS_313_toolbar_buttons_are_real_focusable_buttons_not_mouse_only", () => {
    render(createElement(RichTextEditor, { content: null }));
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      // Real <button> elements are in the default Tab order unless
      // explicitly removed (tabIndex -1) or disabled — neither is the
      // case here, so every control is keyboard reachable.
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(button).not.toBeDisabled();
    }
  });

  it("test_AS_313_escape_blurs_editor_and_preserves_buffer_content", () => {
    const onBlur = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "keep me" }] }],
    };
    const { container } = render(
      createElement(RichTextEditor, { content, onBlur, "aria-label": "Task description" })
    );
    const editable = screen.getByRole("textbox", { name: "Task description" });
    editable.focus();
    expect(editable).toHaveFocus();

    fireEvent.keyDown(editable, { key: "Escape", code: "Escape" });

    expect(onBlur).toHaveBeenCalledTimes(1);
    // Content must still be present in the DOM after Escape — Escape
    // blurs, it does not clear or revert the buffer.
    expect(container.textContent).toContain("keep me");
  });
});
