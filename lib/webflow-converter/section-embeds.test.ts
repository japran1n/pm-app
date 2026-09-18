import { describe, expect, it } from "vitest";
import { emitWebflow } from "./emit";
import { parseCss } from "./css";
import { convert } from "./convert";

// M7: CSS embed + JS embed injection into every <section>. Unsupported CSS
// properties (grid-template-columns/-rows/-areas, text-decoration-color/
// -thickness/-style) are no longer dropped with only a warning — they're
// relocated into a CSS embed. Script content is additionally injected as a
// JS embed into every <section>.

describe("M7 section embeds — CSS embed", () => {
  it("test_M7_css_embed_is_first_child_of_section_and_contains_unsupported_css", () => {
    const css = `.grid { display: grid; grid-template-columns: repeat(3, 1fr); }`;
    const { payload } = emitWebflow('<section class="grid"><div>x</div></section>', parseCss(css));
    const section = payload.payload.nodes[0];
    expect(section.tag).toBe("section");
    const first = section.children[0];
    expect("type" in first && first.type).toBe("HtmlEmbed");
    expect("classes" in first && first.classes).toEqual(["is-hidden"]);
    const html = "data" in first ? (first.data.html as string) : "";
    expect(html).toContain("<style>");
    expect(html).toContain(".grid");
    expect(html).toContain("grid-template-columns: repeat(3, 1fr);");
  });

  it("test_M7_css_embed_covers_all_classes_used_within_the_section_subtree", () => {
    const css = `
      .a { grid-template-rows: 1fr 1fr; }
      .b { text-decoration-color: red; }
    `;
    const { payload } = emitWebflow(
      '<section><div class="a"><span class="b">t</span></div></section>',
      parseCss(css)
    );
    const section = payload.payload.nodes[0];
    const embed = section.children[0];
    const html = "data" in embed ? (embed.data.html as string) : "";
    expect(html).toContain(".a");
    expect(html).toContain("grid-template-rows: 1fr 1fr;");
    expect(html).toContain(".b");
    expect(html).toContain("text-decoration-color: red;");
  });

  it("test_M7_no_css_embed_when_section_has_no_unsupported_css", () => {
    const css = `.card { color: red; padding-top: 4px; }`;
    const { payload } = emitWebflow('<section class="card"></section>', parseCss(css));
    const section = payload.payload.nodes[0];
    const hasEmbed = section.children.some((c) => "type" in c && c.type === "HtmlEmbed");
    expect(hasEmbed).toBe(false);
  });

  it("test_M7_no_embeds_added_when_there_is_no_section_element", () => {
    const css = `.grid { grid-template-columns: 1fr 1fr; }`;
    const { payload } = emitWebflow('<div class="grid"></div>', parseCss(css));
    const hasIsHidden = payload.payload.styles.some((s) => s.name === "is-hidden");
    expect(hasIsHidden).toBe(false);
  });

  it("test_M7_unsupported_css_no_longer_produces_a_dropped_property_warning", () => {
    const css = `.grid { grid-template-columns: repeat(3, 1fr); }`;
    const { warnings } = emitWebflow('<section class="grid"></section>', parseCss(css));
    expect(warnings.some((w) => w.toLowerCase().includes("grid-template-columns"))).toBe(false);
  });

  it("test_M7_is_hidden_style_stub_added_with_display_none_when_an_embed_exists", () => {
    const css = `.grid { grid-template-columns: 1fr; }`;
    const { payload } = emitWebflow('<section class="grid"></section>', parseCss(css));
    const stub = payload.payload.styles.find((s) => s.name === "is-hidden");
    expect(stub).toBeDefined();
    expect(stub!.styleLess).toBe("display: none;");
  });
});

describe("M7 section embeds — JS embed", () => {
  it("test_M7_js_embed_is_last_child_of_section_when_script_exists", () => {
    const html = '<section><div>hi</div><script>console.log("hi");</script></section>';
    const { payload } = convert(html, "");
    const section = payload!.payload.nodes.find((n) => n.tag === "section")!;
    const last = section.children[section.children.length - 1];
    expect("type" in last && last.type).toBe("HtmlEmbed");
    const embedHtml = "data" in last ? (last.data.html as string) : "";
    expect(embedHtml).toContain("<script>");
    expect(embedHtml).toContain('console.log("hi");');
  });

  it("test_M7_no_js_embed_when_there_is_no_script", () => {
    const { payload } = emitWebflow("<section><div>hi</div></section>", parseCss(""));
    const section = payload.payload.nodes[0];
    const hasEmbed = section.children.some((c) => "type" in c && c.type === "HtmlEmbed");
    expect(hasEmbed).toBe(false);
  });
});
