// @vitest-environment jsdom
//
// F171: safe rendering of rich text (components/editor/rich-text-editor.tsx
// — RichTextRenderer / sanitiseDocument).
//
// AS-307: formatting survives a reload — a document with real formatting
//         (bold, a heading, a list) is rendered from freshly-constructed
//         JSON (as if it had just come back from a fresh server fetch after
//         a reload, not from an in-memory editor buffer) and the formatting
//         is still there.
// AS-309: a pasted script tag never executes when rendered — hostile Tiptap
//         JSON (an unknown "script" node type, an on*-event-handler-like
//         attribute injected into a node/mark's attrs, and a `javascript:`
//         href on a link mark) is rendered inert: no executable script tag
//         reaches the DOM, no `javascript:` URL survives, and no on*
//         attribute survives.

import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  RichTextRenderer,
  sanitiseDocument,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

describe("AS-307: formatting survives a reload", () => {
  it("test_AS_307_bold_heading_and_list_survive_a_fresh_render_from_stored_JSON", () => {
    // This document is constructed fresh, as `getTaskDetail` would hand it
    // back after a page reload — not derived from a live editor instance
    // that just typed it. Round-tripping it through `RichTextRenderer`
    // proves the STORED shape still renders with formatting intact, not
    // just formatting that survives within one editing session.
    const storedAfterReload: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Release notes" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "Important:" },
            { type: "text", text: " read before shipping." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Backfill ran" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Migration applied" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const { container } = render(
      createElement(RichTextRenderer, {
        content: storedAfterReload,
        "aria-label": "Description preview",
      }),
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Release notes" }),
    ).toBeInTheDocument();

    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("Important:");

    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(within(ul as HTMLElement).getByText("Backfill ran")).toBeInTheDocument();
    expect(within(ul as HTMLElement).getByText("Migration applied")).toBeInTheDocument();
  });

  it("test_AS_307_second_independent_render_from_the_same_stored_JSON_matches_the_first", () => {
    // Simulates "reload" more literally: render, unmount (as navigating
    // away/closing the sheet would), then mount a brand-new instance from
    // the same stored JSON, as a fresh page load would. This proves
    // nothing about formatting depends on the first render's live editor
    // instance/state.
    const stored: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "bold" },
            { type: "text", text: " plain" },
          ],
        },
      ],
    };

    const first = render(createElement(RichTextRenderer, { content: stored }));
    const firstStrong = first.container.querySelector("strong")?.textContent;
    first.unmount();

    const second = render(createElement(RichTextRenderer, { content: stored }));
    const secondStrong = second.container.querySelector("strong")?.textContent;

    expect(firstStrong).toBe("bold");
    expect(secondStrong).toBe("bold");
  });
});

describe("AS-309: a pasted script tag never executes when rendered", () => {
  it("test_AS_309_unknown_script_node_type_is_stripped_not_rendered", () => {
    // Hostile Tiptap JSON: a fabricated "script" node type that does not
    // exist in the shared schema, carrying a raw HTML-looking payload in
    // an arbitrary attrs field, alongside legitimate content.
    const hostileDoc = {
      type: "doc",
      content: [
        {
          type: "script",
          attrs: { src: "javascript:alert(document.cookie)" },
          content: [{ type: "text", text: "alert(document.cookie)" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "safe paragraph" }],
        },
      ],
    } as unknown as JSONContent;

    const { container } = render(
      createElement(RichTextRenderer, { content: hostileDoc }),
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("<script");
    expect(container.innerHTML).not.toContain("alert(document.cookie)");
    // The legitimate sibling content still renders — sanitisation drops
    // only the hostile node, not the whole document.
    expect(screen.getByText("safe paragraph")).toBeInTheDocument();
  });

  it("test_AS_309_on_star_event_handler_attribute_injected_into_attrs_never_reaches_the_DOM", () => {
    const hostileDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          // "onclick"/"onerror" injected directly into a legitimate node's
          // attrs object, as a hostile stored document might attempt.
          attrs: {
            onclick: "alert(1)",
            onerror: "alert(2)",
          },
          content: [{ type: "text", text: "hostile attrs paragraph" }],
        },
      ],
    } as unknown as JSONContent;

    const { container } = render(
      createElement(RichTextRenderer, { content: hostileDoc }),
    );

    const paragraph = screen.getByText("hostile attrs paragraph");
    expect(paragraph.closest("p")).not.toBeNull();
    expect(paragraph.closest("p")).not.toHaveAttribute("onclick");
    expect(paragraph.closest("p")).not.toHaveAttribute("onerror");
    expect(container.innerHTML).not.toContain("onclick");
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("test_AS_309_javascript_protocol_href_on_link_mark_is_stripped_not_just_hidden", () => {
    const hostileDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [
                {
                  type: "link",
                  attrs: { href: "javascript:alert(document.cookie)" },
                },
              ],
              text: "click me",
            },
          ],
        },
      ],
    };

    const { container } = render(
      createElement(RichTextRenderer, { content: hostileDoc }),
    );

    // The text still renders (sanitisation neutralises the hostile mark,
    // it doesn't have to delete the whole surrounding content), but there
    // must be no anchor with a javascript: URL anywhere in the output —
    // not disabled, not aria-hidden, genuinely absent as an executable
    // href.
    expect(screen.getByText("click me")).toBeInTheDocument();
    const anchors = container.querySelectorAll("a");
    for (const a of Array.from(anchors)) {
      expect(a.getAttribute("href")).not.toMatch(/^javascript:/i);
    }
    expect(container.innerHTML.toLowerCase()).not.toContain("javascript:");
  });

  it("test_AS_309_obfuscated_javascript_protocol_with_control_chars_is_also_stripped", () => {
    // A classic bypass: whitespace/control characters spliced into the
    // scheme name to dodge naive substring checks.
    const hostileDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [
                {
                  type: "link",
                  attrs: { href: "java\tscript:alert(1)" },
                },
              ],
              text: "sneaky link",
            },
          ],
        },
      ],
    };

    const { container } = render(
      createElement(RichTextRenderer, { content: hostileDoc }),
    );

    const anchors = container.querySelectorAll("a");
    for (const a of Array.from(anchors)) {
      const href = a.getAttribute("href") ?? "";
      expect(href.replace(/\s/g, "").toLowerCase()).not.toMatch(/^javascript:/);
    }
  });

  it("test_AS_309_http_https_mailto_links_are_preserved_with_rel_noopener_noreferrer", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              text: "https link",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "mailto:a@example.com" } }],
              text: "mailto link",
            },
          ],
        },
      ],
    };

    const { container } = render(createElement(RichTextRenderer, { content: doc }));
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.length).toBe(2);
    for (const a of anchors) {
      const rel = a.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    }
  });

  it("test_AS_309_sanitiseDocument_never_throws_on_deeply_malformed_input_and_degrades_to_empty_doc", () => {
    const garbage = {
      type: "doc",
      content: "not-an-array",
    } as unknown as JSONContent;

    expect(() => sanitiseDocument(garbage)).not.toThrow();
    // Malformed `content` (not an array) degrades to a doc with no
    // content array at all — still a well-formed, empty Tiptap document
    // (equivalent to `{ type: "doc", content: [] }` for rendering
    // purposes; ProseMirror treats a missing `content` the same as an
    // empty array).
    expect(sanitiseDocument(garbage)).toEqual({ type: "doc" });
    expect(sanitiseDocument(null)).toEqual({ type: "doc", content: [] });
    expect(sanitiseDocument(undefined)).toEqual({ type: "doc", content: [] });

    // A render from this garbage must not throw either.
    expect(() =>
      render(createElement(RichTextRenderer, { content: garbage })),
    ).not.toThrow();
  });
});
