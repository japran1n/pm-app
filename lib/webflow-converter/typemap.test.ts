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
});
