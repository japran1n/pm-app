// F122: link marks are stored without an href, so every link is dropped
// on render.
//
// Hard evidence (from the live database, captured in the feature spec):
// the stored body_json for a message containing a bare URL was
//   {"type":"doc","content":[{"type":"paragraph","content":[
//     {"text":"https://www.youtube.com/watch?v=W4drPiXwlyc",
//      "type":"text","marks":[{"type":"link"}]}]}]}
// -- a `link` mark with NO `attrs`/`href` at all. F120's server-side
// autolinker (lib/chat/autolink-body.ts) skipped this node because its
// "already linked, don't re-wrap" guard only checked `mark.type === "link"`,
// never whether the mark actually carried a usable href. This file tests
// the fixed guard (AS-076/AS-077) and confirms the renderer's sanitiser
// keeps correctly dropping a href-less link mark rather than fabricating
// one (AS-078, must never regress).

// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { autolinkBody } from "@/lib/chat/autolink-body";
import { extractLinkHrefs } from "@/lib/chat/extract-links";
import { sanitiseDocument, RichTextRenderer } from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

/** The exact real-world shape captured from the live database. */
function hrefLessLinkDoc(url: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            text: url,
            type: "text",
            marks: [{ type: "link" }],
          },
        ],
      },
    ],
  };
}

describe("autolinkBody repairs a href-less link mark (AS-076, AS-077)", () => {
  it("test_AS_076_href_less_link_mark_is_not_treated_as_already_linked", () => {
    const url = "https://www.youtube.com/watch?v=W4drPiXwlyc";
    const doc = hrefLessLinkDoc(url);

    const linked = autolinkBody(doc as never);
    const hrefs = extractLinkHrefs(linked as never);

    // The old guard's `return [node]` (unchanged) meant this always came
    // back empty -- extractLinkHrefs only reads marks with a real string
    // href (lib/chat/extract-links.ts).
    expect(hrefs).toEqual([url]);
  });

  it("test_AS_077_repaired_node_carries_exactly_one_link_mark_no_duplicate", () => {
    const url = "https://www.youtube.com/watch?v=W4drPiXwlyc";
    const doc = hrefLessLinkDoc(url);

    const linked = autolinkBody(doc as never) as {
      content: Array<{ content: Array<{ marks?: Array<{ type: string; attrs?: { href?: unknown } }> }> }>;
    };
    const textNode = linked.content[0]!.content![0]!;
    const linkMarks = (textNode.marks ?? []).filter((m) => m.type === "link");

    expect(linkMarks).toHaveLength(1);
    expect(linkMarks[0]!.attrs?.href).toBe(url);
  });

  it("test_AS_077_a_real_link_mark_with_a_usable_href_is_left_alone", () => {
    // The guard must still skip genuinely-already-linked text (e.g. the
    // toolbar's manual Link button) -- never re-wrap or duplicate it.
    const url = "https://example.com/already-linked";
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: url,
              marks: [{ type: "link", attrs: { href: url } }],
            },
          ],
        },
      ],
    };

    const linked = autolinkBody(doc as never) as {
      content: Array<{ content: Array<{ marks?: Array<{ type: string; attrs?: { href?: unknown } }> }> }>;
    };
    const textNode = linked.content[0]!.content![0]!;
    const linkMarks = (textNode.marks ?? []).filter((m) => m.type === "link");

    expect(linkMarks).toHaveLength(1);
    expect(linkMarks[0]!.attrs?.href).toBe(url);
  });

  it("test_AS_077_href_that_is_empty_string_is_also_treated_as_unlinked", () => {
    const url = "https://example.com/empty-href";
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: url, marks: [{ type: "link", attrs: { href: "" } }] },
          ],
        },
      ],
    };

    const linked = autolinkBody(doc as never);
    const hrefs = extractLinkHrefs(linked as never);

    expect(hrefs).toEqual([url]);
  });

  it("test_AS_077_href_less_link_mark_around_non_url_text_is_stripped_not_left_dangling", () => {
    // No URL to linkify in the text -- the href-less mark must still not
    // survive, since the renderer would otherwise carry a mark with no
    // destination into sanitisation (which drops it anyway, but the
    // in-memory doc should already be clean coming out of this function).
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "just some words", marks: [{ type: "link" }] }],
        },
      ],
    };

    const linked = autolinkBody(doc as never) as {
      content: Array<{ content: Array<{ marks?: Array<{ type: string }> }> }>;
    };
    const textNode = linked.content[0]!.content![0]!;
    expect((textNode.marks ?? []).some((m) => m.type === "link")).toBe(false);
  });
});

describe("end-to-end: send -> autolinkBody -> stored body_json -> rendered DOM (AS-076, AS-077)", () => {
  it("test_AS_076_full_pipeline_the_exact_reported_message_ends_up_with_a_real_anchor", async () => {
    // Exact reported input (the client-sent, href-less shape) through the
    // exact server-side repair function, through the exact renderer the
    // chat UI uses -- both halves of the DoD's "verify BOTH the stored
    // body_json AND the rendered DOM" requirement, in one pipeline.
    const url = "https://www.youtube.com/watch?v=W4drPiXwlyc";
    const clientSent = hrefLessLinkDoc(url);

    // 1) What sendMessage persists (lib/actions/chat-messages.ts calls
    // autolinkBody then toPlainJson before the insert).
    const storedBodyJson = JSON.parse(JSON.stringify(autolinkBody(clientSent as never)));
    const storedHrefs = extractLinkHrefs(storedBodyJson as never);
    expect(storedHrefs).toEqual([url]);

    // 2) What message-list.tsx's RichTextRenderer puts on screen for that
    // exact stored body_json.
    render(createElement(RichTextRenderer, { content: storedBodyJson }));
    const link = await waitFor(() => screen.getByRole("link", { name: /youtube\.com/i }));
    expect(link).toHaveAttribute("href", url);
  });
});

describe("sanitiseDocument still drops a href-less link mark, never fabricates one (AS-078)", () => {
  it("test_AS_078_href_less_link_mark_renders_with_no_anchor_and_no_fabricated_href", () => {
    const url = "https://www.youtube.com/watch?v=W4drPiXwlyc";
    const doc = hrefLessLinkDoc(url);

    const safe = sanitiseDocument(doc as never) as {
      content: Array<{ content?: Array<{ marks?: Array<{ type: string }>; text?: string }> }>;
    };
    const textNode = safe.content[0]!.content![0]!;

    // The text itself survives (plain text, exactly F122's reported
    // symptom), but the href-less mark must be gone -- never repaired at
    // render time, never given a fabricated href derived from its own text.
    expect(textNode.text).toBe(url);
    expect((textNode.marks ?? []).some((m) => m.type === "link")).toBe(false);
  });

  it("test_AS_078_a_link_mark_with_a_real_href_still_renders_normally", () => {
    const url = "https://example.com/fine";
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }],
        },
      ],
    };

    const safe = sanitiseDocument(doc as never) as {
      content: Array<{ content?: Array<{ marks?: Array<{ type: string; attrs?: { href?: unknown } }> }> }>;
    };
    const textNode = safe.content[0]!.content![0]!;
    const linkMark = (textNode.marks ?? []).find((m) => m.type === "link");

    expect(linkMark?.attrs?.href).toBe(url);
  });
});
