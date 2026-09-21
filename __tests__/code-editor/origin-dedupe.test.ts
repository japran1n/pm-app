// moden-style origin labels + CMS embed dedupe + compose fan-out.

import { describe, expect, it } from "vitest";
import {
  blockSignature,
  deduplicateBlocks,
  detectOrigin,
  extractScriptBlocks,
  extractStyleBlocks,
} from "@/lib/code-editor/extract";
import { composeDocument } from "@/lib/code-editor/compose";

const PAGE = `<!DOCTYPE html><html><head>
<style>.nav{color:red}</style>
<script>const headInit = 1;</script>
</head><body>
<div class="section"><div class="w-embed"><style>.card{gap:1rem}</style></div></div>
<div class="w-dyn-item"><div class="card-embed w-embed"><script>window.cardData = { id: "64f0c3a1b2c3d4e5f6a7b8c9", url: "https://a.com/x", n: 1 };</script></div></div>
<div class="w-dyn-item"><div class="card-embed w-embed"><script>window.cardData = { id: "64f0c3a1b2c3d4e5f6a7b8d0", url: "https://a.com/y", n: 2 };</script></div></div>
<div class="w-dyn-item"><div class="card-embed w-embed"><script>window.cardData = { id: "64f0c3a1b2c3d4e5f6a7b8d1", url: "https://a.com/z", n: 3 };</script></div></div>
<p>after</p>
<script>const footerCode = true;</script>
</body></html>`;

describe("origin detection", () => {
  it("labels head, embed and footer blocks", () => {
    const styles = extractStyleBlocks(PAGE);
    const scripts = extractScriptBlocks(PAGE);
    expect(styles.map((b) => b.origin)).toEqual(["head", "embed"]);
    expect(scripts.map((b) => b.origin)).toEqual(["head", "embed", "embed", "embed", "footer"]);
  });

  it("a tag after a closed embed element is footer, not embed", () => {
    const html = `<html><head></head><body><div class="w-embed"><div>x</div></div><script>a()</script></body></html>`;
    expect(detectOrigin(html, html.indexOf("<script>"))).toBe("footer");
  });

  it("recognises code components and rich-text embeds", () => {
    const html = `<html><head></head><body><div class="w-richtext"><p>t</p><style>.a{}</style></div><div class="x w-code-component"><script>b()</script></div></body></html>`;
    expect(detectOrigin(html, html.indexOf("<style>"))).toBe("embed");
    expect(detectOrigin(html, html.indexOf("<script>"))).toBe("embed");
  });
});

describe("CMS embed dedupe", () => {
  it("signature ignores strings, numbers, item IDs and whitespace", () => {
    expect(blockSignature(`x = { a: "1", b: 2 }`)).toBe(blockSignature(`x = {a:'zzz',   b: 99}`));
    expect(blockSignature(`.a{}`)).not.toBe(blockSignature(`.b{}`));
  });

  it("collapses repeated CMS embeds into one block with an occurrence count", () => {
    const scripts = deduplicateBlocks(extractScriptBlocks(PAGE));
    expect(scripts).toHaveLength(3);
    const cms = scripts[1];
    expect(cms.occurrences).toBe(3);
    expect(cms.duplicates).toHaveLength(2);
    expect(cms.origin).toBe("embed");
  });

  it("never merges blocks of different types", () => {
    const merged = deduplicateBlocks([
      { index: 0, type: "style", originalContent: "a{b:c}" },
      { index: 0, type: "script", originalContent: "a{b:c}" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("does not mutate the input blocks", () => {
    const input = extractScriptBlocks(PAGE);
    deduplicateBlocks(input);
    expect(input.every((b) => b.duplicates === undefined)).toBe(true);
  });
});

describe("compose with deduped blocks", () => {
  const blocks = () => [
    ...deduplicateBlocks(extractStyleBlocks(PAGE)),
    ...deduplicateBlocks(extractScriptBlocks(PAGE)),
  ];

  it("round-trips unchanged: every CMS item keeps its own values", () => {
    expect(composeDocument(PAGE, blocks())).toBe(PAGE);
  });

  it("an edit to the deduped block is applied to all occurrences", () => {
    const all = blocks();
    const cms = all.find((b) => b.occurrences === 3)!;
    cms.content = "window.cardData = null;";
    const out = composeDocument(PAGE, all);
    expect(out.match(/window\.cardData = null;/g)).toHaveLength(3);
    expect(out).not.toContain("https://a.com/y");
    // Other blocks untouched and nothing appended.
    expect(out).toContain("const footerCode = true;");
    expect(out.match(/<script>/g)).toHaveLength(5);
  });

  it("editing a block that precedes the duplicates still locates later blocks", () => {
    const all = blocks();
    const head = all.find((b) => b.type === "script" && b.origin === "head")!;
    head.content = "const headInit = 2;";
    const footer = all.find((b) => b.origin === "footer")!;
    footer.content = "const footerCode = false;";
    const out = composeDocument(PAGE, all);
    expect(out).toContain("const headInit = 2;");
    expect(out).toContain("const footerCode = false;");
    expect(out).toContain("https://a.com/y");
  });
});
