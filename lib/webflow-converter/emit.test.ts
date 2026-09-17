import { describe, expect, it } from "vitest";
import { emitWebflow, emitWebflowFromSource } from "./emit";
import { parseCss } from "./css";

// F018: node tree assembly — walks parsed HTML + parsed CSS into Webflow's
// XscpData clipboard shape. Covers AS-089 through AS-094, AS-047, AS-042
// through AS-045, and AS-051.

describe("emitWebflow — node walk", () => {
  it("test_AS_089_090_simple_div_with_class_produces_block_node_with_classes", () => {
    const { payload } = emitWebflow('<div class="card"></div>', parseCss(""));
    expect(payload.payload.nodes).toHaveLength(1);
    const node = payload.payload.nodes[0];
    expect(node.type).toBe("Block");
    expect(node.tag).toBe("div");
    expect(node.classes).toEqual(["card"]);
    expect(node._id).toBeTruthy();
    expect(node.v).toBe(1);
  });

  it("test_AS_091_heading_h1_produces_heading_type_with_level", () => {
    const { payload } = emitWebflow('<h1 class="title">Hi</h1>', parseCss(""));
    const node = payload.payload.nodes[0];
    expect(node.type).toBe("Heading");
    expect(node.tag).toBe("h1");
    expect(node.data.level).toBe(1);
  });

  it("test_AS_092_nested_elements_produce_correct_children_tree", () => {
    const html = `
      <div class="parent">
        <p class="child-a">a</p>
        <span class="child-b">b</span>
      </div>
    `;
    const { payload } = emitWebflow(html, parseCss(""));
    const root = payload.payload.nodes[0];
    expect(root.classes).toEqual(["parent"]);
    expect(root.children).toHaveLength(2);
    expect(root.children[0].type).toBe("Paragraph");
    expect(root.children[0].classes).toEqual(["child-a"]);
    expect(root.children[1].type).toBe("Block");
    expect(root.children[1].classes).toEqual(["child-b"]);
  });

  it("test_AS_089_script_and_style_elements_produce_no_node", () => {
    const html = `
      <div class="wrap">
        <script>console.log('x')</script>
        <style>.a{color:red}</style>
        <p class="text">hi</p>
      </div>
    `;
    const { payload } = emitWebflow(html, parseCss(""));
    const root = payload.payload.nodes[0];
    expect(root.children).toHaveLength(1);
    expect(root.children[0].type).toBe("Paragraph");
  });

  it("test_AS_093_data_attributes_carry_through_as_xattr_reserved_attrs_excluded", () => {
    const html =
      '<div class="card" id="hero" style="color:red" href="#" src="x.png" alt="pic" target="_blank" data-foo="bar" data-baz="qux"></div>';
    const { payload } = emitWebflow(html, parseCss(""));
    const node = payload.payload.nodes[0];
    expect(node.data.xattr).toEqual([
      { name: "data-foo", value: "bar" },
      { name: "data-baz", value: "qux" },
    ]);
  });

  it("test_AS_094_root_node_ordering_preserved", () => {
    const html = '<section class="one"></section><div class="two"></div>';
    const { payload } = emitWebflow(html, parseCss(""));
    expect(payload.payload.nodes).toHaveLength(2);
    expect(payload.payload.nodes[0].classes).toEqual(["one"]);
    expect(payload.payload.nodes[1].classes).toEqual(["two"]);
  });

  it("test_AS_047_inline_style_attribute_produces_warning_during_node_walk", () => {
    const { warnings } = emitWebflow('<div class="card" style="color:red"></div>', parseCss(""));
    expect(warnings.some((w) => w.includes("inline style"))).toBe(true);
  });

  it("no inline style warning when style attribute is absent", () => {
    const { warnings } = emitWebflow('<div class="card"></div>', parseCss(""));
    expect(warnings.some((w) => w.includes("inline style"))).toBe(false);
  });
});

describe("emitWebflow — empty input", () => {
  it("empty HTML produces an empty (not undefined) nodes array of the same shape", () => {
    const { payload, warnings } = emitWebflow("", parseCss(""));
    expect(payload.payload.nodes).toEqual([]);
    expect(payload.payload.styles).toEqual([]);
    expect(payload.payload.assets).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe("emitWebflow — CSS to WebflowStyle conversion", () => {
  it("test_AS_051_css_class_in_parseCss_output_produces_webflowstyle_with_correct_styleless", () => {
    const cssMap = parseCss(".card { color: red; font-size: 14px; }");
    const { payload } = emitWebflow("", cssMap);
    expect(payload.payload.styles).toHaveLength(1);
    const style = payload.payload.styles[0];
    expect(style.name).toBe("card");
    expect(style.fake).toBe(false);
    expect(style.comb).toBe("");
    // Alphabetically sorted declarations.
    expect(style.styleLess).toBe("color: red; font-size: 14px;");
  });

  it("responsive @media (max-width: 991px) variant populates styles.variants.medium", () => {
    const cssMap = parseCss(`
      .card { color: red; }
      @media (max-width: 991px) { .card { color: blue; } }
    `);
    const { payload } = emitWebflow("", cssMap);
    const style = payload.payload.styles.find((s) => s.name === "card")!;
    expect(style.variants.medium).toBeDefined();
    expect(style.variants.medium?.styleLess).toBe("color: blue;");
  });

  it("aggregates F012/F014 selector and unsupported-@media warnings into the same warnings list", () => {
    // AS-042: descendant selector rejected. AS-043: id selector rejected.
    const cssMap = parseCss(`
      .card h3 { color: red; }
      #hero { color: blue; }
    `);
    const { warnings } = emitWebflow("", cssMap);
    expect(warnings.some((w) => w.includes('".card h3"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"#hero"'))).toBe(true);
  });
});

describe("emitWebflowFromSource — convenience wrapper", () => {
  it("parses CSS text internally and builds the full payload", () => {
    const html = '<div class="card"><p class="text">hi</p></div>';
    const css = ".card { color: red; }";
    const { payload } = emitWebflowFromSource(html, css);
    expect(payload.payload.nodes[0].classes).toEqual(["card"]);
    expect(payload.payload.styles[0].name).toBe("card");
  });
});
