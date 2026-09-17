import { describe, expect, it } from "vitest";
import { getWebflowType } from "./typemap";

describe("getWebflowType", () => {
  // AS-077: <section> -> Section
  it("test_AS_077_section_converts_to_section", () => {
    expect(getWebflowType("section")).toMatchObject({ type: "Section", tag: "section" });
  });

  it("test_AS_077_header_and_footer_convert_to_section", () => {
    expect(getWebflowType("header")).toMatchObject({ type: "Section", tag: "header" });
    expect(getWebflowType("footer")).toMatchObject({ type: "Section", tag: "footer" });
  });

  // AS-078: <div> -> Block
  it("test_AS_078_div_converts_to_block", () => {
    expect(getWebflowType("div")).toMatchObject({ type: "Block", tag: "div" });
  });

  it("test_AS_078_other_structural_semantic_tags_convert_to_block", () => {
    expect(getWebflowType("main")).toMatchObject({ type: "Block", tag: "main" });
    expect(getWebflowType("article")).toMatchObject({ type: "Block", tag: "article" });
    expect(getWebflowType("aside")).toMatchObject({ type: "Block", tag: "aside" });
    expect(getWebflowType("nav")).toMatchObject({ type: "Block", tag: "nav" });
    expect(getWebflowType("figure")).toMatchObject({ type: "Block", tag: "figure" });
  });

  // AS-079: h1-h6 -> Heading with matching level
  it("test_AS_079_h1_through_h6_convert_to_heading_with_matching_level", () => {
    for (let n = 1; n <= 6; n++) {
      const tag = `h${n}`;
      const result = getWebflowType(tag);
      expect(result.type).toBe("Heading");
      expect(result.level).toBe(n);
      expect(result.tag).toBe(tag);
    }
  });

  // AS-080: <p> -> Paragraph
  it("test_AS_080_p_converts_to_paragraph", () => {
    expect(getWebflowType("p")).toMatchObject({ type: "Paragraph", tag: "p" });
  });

  it("test_AS_080_blockquote_converts_to_blockquote", () => {
    expect(getWebflowType("blockquote")).toMatchObject({ type: "Blockquote", tag: "blockquote" });
  });

  // AS-081: ul/ol -> List, li -> ListItem
  it("test_AS_081_ul_and_ol_convert_to_list", () => {
    expect(getWebflowType("ul")).toMatchObject({ type: "List", tag: "ul" });
    expect(getWebflowType("ol")).toMatchObject({ type: "List", tag: "ol" });
  });

  it("test_AS_081_li_converts_to_list_item", () => {
    expect(getWebflowType("li")).toMatchObject({ type: "ListItem", tag: "li" });
  });

  // Unknown elements default to Block with warning
  it("test_unknown_element_defaults_to_block_with_warning", () => {
    const result = getWebflowType("custom-widget");
    expect(result.type).toBe("Block");
    expect(result.tag).toBe("div");
    expect(result.warning).toContain("custom-widget");
  });

  // Case-insensitivity
  it("test_case_insensitive_tag_names", () => {
    expect(getWebflowType("DIV")).toMatchObject({ type: "Block", tag: "div" });
    expect(getWebflowType("Div")).toMatchObject({ type: "Block", tag: "div" });
    expect(getWebflowType("H2")).toMatchObject({ type: "Heading", tag: "h2", level: 2 });
    expect(getWebflowType("SECTION")).toMatchObject({ type: "Section", tag: "section" });
  });

  // Inline text-carrying tags map to Block per the prototype
  it("test_inline_text_tags_map_to_block_with_text_data", () => {
    expect(getWebflowType("span")).toMatchObject({ type: "Block", tag: "span", data: { text: true } });
    expect(getWebflowType("strong")).toMatchObject({ type: "Block", tag: "strong" });
  });

  // AS-082: <a> with only text content -> Link
  it("test_AS_082_a_with_text_only_converts_to_link", () => {
    const result = getWebflowType("a", { hasElementChildren: false, attrs: {} });
    expect(result.type).toBe("Link");
    expect(result.tag).toBe("a");
  });

  it("test_AS_082_a_with_href_target_rel_carries_link_data", () => {
    const result = getWebflowType("a", {
      hasElementChildren: false,
      attrs: { href: "https://example.com", target: "_blank", rel: "noopener" },
    });
    expect(result.type).toBe("Link");
    expect(result.data?.link).toMatchObject({ url: "https://example.com", target: "_blank", mode: "external" });
  });

  // AS-083: <a> with element children -> Link Block
  it("test_AS_083_a_with_element_children_converts_to_link_block", () => {
    const result = getWebflowType("a", { hasElementChildren: true, attrs: { href: "/about" } });
    expect(result.type).toBe("LinkBlock");
    expect(result.tag).toBe("a");
    expect(result.data?.link).toMatchObject({ url: "/about" });
  });

  // AS-084: <button> -> Webflow Button-equivalent with warning
  it("test_AS_084_button_converts_to_link_button_with_warning", () => {
    const result = getWebflowType("button");
    expect(result.type).toBe("Link");
    expect(result.tag).toBe("a");
    expect(result.data?.button).toBe(true);
    expect(result.warning).toContain("Submit button");
  });

  // AS-085 / AS-133: <form>/<input>/<textarea>/<select> -> Block with rebuild-in-Designer warning
  it("test_AS_085_form_converts_to_block_with_warning", () => {
    const result = getWebflowType("form");
    expect(result.type).toBe("Block");
    expect(result.tag).toBe("div");
    expect(result.warning).toContain("rebuild forms in the Designer");
  });

  it("test_AS_085_form_control_descendants_convert_to_block_with_warning", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const result = getWebflowType(tag);
      expect(result.type).toBe("Block");
      expect(result.tag).toBe("div");
      expect(result.warning).toContain("rebuild forms in the Designer");
    }
  });
});
