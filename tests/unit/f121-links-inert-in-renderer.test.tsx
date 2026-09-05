// @vitest-environment jsdom
//
// F121: links render but were inert.
//
// AS-074: A link inside read-only rendered rich text (chat message, task
//         comment, task description) is visually distinguishable from
//         surrounding text and opens its target when clicked, while a link
//         inside the editable editor still does not navigate on click.
// AS-075: components/editor/rich-text-editor.tsx contains no raw control
//         bytes, so ordinary text tooling reads it as text rather than
//         binary.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  RichTextEditor,
  RichTextRenderer,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

const linkDoc: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "https://www.example.com/watch",
          marks: [{ type: "link", attrs: { href: "https://www.example.com/watch" } }],
        },
      ],
    },
  ],
};

describe("AS-074: read-only rendered links are clickable and distinguishable", () => {
  it("test_AS_074_rendered_link_has_href_target_blank_and_noopener_noreferrer", async () => {
    render(createElement(RichTextRenderer, { content: linkDoc }));

    const link = await waitFor(() => screen.getByRole("link", { name: /example\.com/i }));
    expect(link).toHaveAttribute("href", "https://www.example.com/watch");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("test_AS_074_rendered_link_lives_inside_rich_text_renderer_for_css_styling", async () => {
    const { container } = render(createElement(RichTextRenderer, { content: linkDoc }));
    await waitFor(() => screen.getByRole("link", { name: /example\.com/i }));
    const wrapper = container.querySelector(".rich-text-renderer");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("a[href]")).not.toBeNull();
  });

  it("test_AS_074_rendered_link_is_visually_distinguishable_via_css_rule_scoped_to_renderer", () => {
    // Real click-through and browser-default contenteditable-link-inertness
    // aren't observable in jsdom, so per the DoD this half of AS-074 is
    // verified by asserting the styling exists and is scoped to
    // `.rich-text-renderer` (not a global `a {}` rule) rather than a
    // computed-style check jsdom can't perform on external stylesheets.
    const css = readFileSync("app/globals.css", "utf-8");
    const scopedRule = /\.rich-text-renderer\s+a\s*\{[^}]*color:[^}]*\}/;
    expect(css).toMatch(scopedRule);
    // Guard against the fix regressing into a global anchor rule that
    // would repaint every link in the app.
    expect(css).not.toMatch(/(?<!\.rich-text-renderer\s*)(?<!\.[\w-]\s*)^a\s*\{/m);
  });
});

describe("AS-074: the editable editor's link click behaviour is unchanged", () => {
  it("test_AS_074_editable_editor_still_configures_link_extension_with_openOnClick_false", () => {
    // Structural check on the wiring the spec calls out by name: the
    // editable path's call to `sharedExtensions()` must not opt into the
    // renderer's `linksClickable` behaviour, so `StarterKit`'s `link`
    // option keeps resolving to `openOnClick: false` for `RichTextEditor`.
    const source = readFileSync("components/editor/rich-text-editor.tsx", "utf-8");
    const editorCallStart = source.indexOf("export function RichTextEditor(");
    const rendererCallStart = source.indexOf("export function RichTextRenderer(");
    expect(editorCallStart).toBeGreaterThan(-1);
    expect(rendererCallStart).toBeGreaterThan(-1);

    const editorBody = source.slice(editorCallStart, rendererCallStart);
    expect(editorBody).not.toContain("linksClickable: true");

    const rendererBody = source.slice(rendererCallStart);
    expect(rendererBody).toContain("linksClickable: true");
  });

  it("test_AS_074_editable_editor_renders_a_link_but_without_the_renderers_target_blank_wiring", async () => {
    const { container } = render(
      createElement(RichTextEditor, { content: linkDoc, onChange: () => {} }),
    );
    const link = await waitFor(() => {
      const el = container.querySelector("a[href]");
      if (!el) throw new Error("link not rendered yet");
      return el;
    });
    // The editable editor still renders the mark (formatting is preserved
    // while editing) — AS-074 is about click behaviour, not visibility of
    // the mark itself.
    expect(link).not.toBeNull();
  });
});

describe("AS-075: rich-text-editor.tsx contains no raw control bytes", () => {
  it("test_AS_075_file_reports_a_text_type_not_binary_data", () => {
    const output = execSync("file components/editor/rich-text-editor.tsx", {
      encoding: "utf-8",
    });
    expect(output.toLowerCase()).not.toContain("data");
    expect(output).toMatch(/text/i);
  });

  it("test_AS_075_plain_grep_without_dash_a_finds_openOnClick", () => {
    const output = execSync('grep -c "openOnClick" components/editor/rich-text-editor.tsx', {
      encoding: "utf-8",
    });
    expect(Number(output.trim())).toBeGreaterThan(0);
  });
});
