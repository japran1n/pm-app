import { describe, expect, it } from "vitest";
import { emitWebflow } from "./emit";
import { parseCss } from "./css";
import { convert } from "./convert";

// M7: CSS embed + JS embed injection into every <section>. Unsupported CSS
// properties (e.g. background-attachment, background-position,
// background-size, background-repeat — none have a Webflow style-type
// entry) are no longer dropped with only a warning — they're relocated
// into a CSS embed. Script content is additionally injected as a JS embed
// into every <section>.

describe("M7 section embeds — CSS embed", () => {
  it("test_M7_css_embed_is_first_child_of_section_and_contains_unsupported_css", () => {
    const css = `.grid { display: grid; background-attachment: repeat(3, 1fr); }`;
    const { payload } = emitWebflow('<section class="grid"><div>x</div></section>', parseCss(css));
    const section = payload.payload.nodes[0];
    expect(section.tag).toBe("section");
    const first = section.children[0];
    expect("type" in first && first.type).toBe("HtmlEmbed");
    expect("classes" in first && first.classes).toEqual(["is-hidden"]);
    const html = "data" in first ? (first.data.html as string) : "";
    expect(html).toContain("<style>");
    expect(html).toContain(".grid");
    expect(html).toContain("background-attachment: repeat(3, 1fr);");
  });

  it("test_M7_css_embed_covers_all_classes_used_within_the_section_subtree", () => {
    const css = `
      .a { background-position: 1fr 1fr; }
      .b { background-size: red; }
    `;
    const { payload } = emitWebflow(
      '<section><div class="a"><span class="b">t</span></div></section>',
      parseCss(css)
    );
    const section = payload.payload.nodes[0];
    const embed = section.children[0];
    const html = "data" in embed ? (embed.data.html as string) : "";
    expect(html).toContain(".a");
    expect(html).toContain("background-position: 1fr 1fr;");
    expect(html).toContain(".b");
    expect(html).toContain("background-size: red;");
  });

  it("test_M7_no_css_embed_when_section_has_no_unsupported_css", () => {
    const css = `.card { color: red; padding-top: 4px; }`;
    const { payload } = emitWebflow('<section class="card"></section>', parseCss(css));
    const section = payload.payload.nodes[0];
    const hasEmbed = section.children.some((c) => "type" in c && c.type === "HtmlEmbed");
    expect(hasEmbed).toBe(false);
  });

  it("test_M7_no_embeds_added_when_there_is_no_section_element", () => {
    const css = `.grid { background-attachment: 1fr 1fr; }`;
    const { payload } = emitWebflow('<div class="grid"></div>', parseCss(css));
    const hasIsHidden = payload.payload.styles.some((s) => s.name === "is-hidden");
    expect(hasIsHidden).toBe(false);
  });

  it("test_M7_unsupported_css_no_longer_produces_a_dropped_property_warning", () => {
    const css = `.grid { background-attachment: repeat(3, 1fr); }`;
    const { warnings } = emitWebflow('<section class="grid"></section>', parseCss(css));
    expect(warnings.some((w) => w.toLowerCase().includes("background-attachment"))).toBe(false);
  });

  it("test_M7_is_hidden_style_stub_added_with_display_none_when_an_embed_exists", () => {
    const css = `.grid { background-attachment: 1fr; }`;
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

describe("M7 section embeds — whitelist-driven property routing", () => {
  it("test_M7_non_whitelisted_property_on_base_rule_is_routed_to_css_embed_not_styleLess", () => {
    // background-repeat has no Webflow style-type entry, unlike the whitelisted
    // properties alongside it in the same rule.
    const css = `.box { color: red; background-repeat: 16 / 9; }`;
    const { payload } = emitWebflow('<section class="box"></section>', parseCss(css));
    const style = payload.payload.styles.find((s) => s.name === "box")!;
    expect(style.styleLess).toBe("color: red;");
    expect(style.styleLess).not.toContain("background-repeat");
    const embed = payload.payload.nodes[0].children[0];
    const html = "data" in embed ? (embed.data.html as string) : "";
    expect(html).toContain("background-repeat: 16 / 9;");
  });

  it("test_M7_non_whitelisted_property_inside_a_medium_media_query_is_reconstructed_as_at_media_in_the_embed", () => {
    const css = `.box { color: red; } @media (max-width: 991px) { .box { background-repeat: 1 / 1; } }`;
    const { payload } = emitWebflow('<section class="box"></section>', parseCss(css));
    const style = payload.payload.styles.find((s) => s.name === "box")!;
    // The whitelisted medium-breakpoint declaration would still land in the
    // medium variant slot if present; here only the unsupported prop exists,
    // so there should be nothing (or nothing containing background-repeat) there.
    expect(style.variants.medium?.styleLess ?? "").not.toContain("background-repeat");
    const embed = payload.payload.nodes[0].children[0];
    const html = "data" in embed ? (embed.data.html as string) : "";
    expect(html).toContain("@media screen and (max-width: 991px)");
    expect(html).toContain("background-repeat: 1 / 1;");
  });

  it("test_M7_non_whitelisted_property_inside_a_small_media_query_uses_the_767px_breakpoint", () => {
    const css = `@media (max-width: 767px) { .box { background-repeat: 4 / 3; } }`;
    const { payload } = emitWebflow('<section class="box"></section>', parseCss(css));
    const embed = payload.payload.nodes[0].children[0];
    const html = "data" in embed ? (embed.data.html as string) : "";
    expect(html).toContain("@media screen and (max-width: 767px)");
    expect(html).toContain("background-repeat: 4 / 3;");
  });

  it("test_M7_whitelisted_medium_property_still_lands_in_the_medium_variant_styleLess", () => {
    const css = `@media (max-width: 991px) { .box { color: blue; } }`;
    const { payload } = emitWebflow('<section class="box"></section>', parseCss(css));
    const style = payload.payload.styles.find((s) => s.name === "box")!;
    expect(style.variants.medium?.styleLess).toBe("color: blue;");
  });
});
