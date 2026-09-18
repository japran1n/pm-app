import { describe, expect, it } from "vitest";
import { emitWebflow, emitWebflowFromSource, isTextNode, type WebflowChild, type WebflowNode, type WebflowStyle } from "./emit";
import { parseCss } from "./css";

// F018: node tree assembly — walks parsed HTML + parsed CSS into Webflow's
// XscpData clipboard shape (a FLAT node array, matching Webflow Designer's
// own real clipboard format — see ground-truth wf.json). Covers AS-089
// through AS-094, AS-047, AS-042 through AS-045, and AS-051.

/** Looks up a flat node by its _id. Throws if not found (fail loud in tests). */
function byId(nodes: WebflowChild[], id: string): WebflowChild {
  const found = nodes.find((n) => n._id === id);
  if (!found) throw new Error(`node ${id} not found in flat nodes array`);
  return found;
}

/** Resolves an element node's style `_id`s to their class NAMEs, in order, via the styles array. */
function classNames(styles: WebflowStyle[], node: WebflowNode): string[] {
  return node.classes.map((id) => {
    const style = styles.find((s) => s._id === id);
    if (!style) throw new Error(`style ${id} not found`);
    return style.name;
  });
}

/** Root nodes are always index 0..N in `nodes` in document order — for these single-root tests, node 0. */
function firstNode(nodes: WebflowChild[]): WebflowNode {
  const n = nodes[0];
  if (isTextNode(n)) throw new Error("expected element node");
  return n;
}

describe("emitWebflow — node walk", () => {
  it("test_AS_089_090_simple_div_with_class_produces_block_node_with_classes", () => {
    const { payload } = emitWebflow('<div class="card"></div>', parseCss(""));
    expect(payload.payload.nodes).toHaveLength(1);
    const node = firstNode(payload.payload.nodes);
    expect(node.type).toBe("Block");
    expect(node.tag).toBe("div");
    expect(classNames(payload.payload.styles, node)).toEqual(["card"]);
    expect(node._id).toBeTruthy();
  });

  it("test_AS_091_heading_h1_produces_heading_type_with_no_level_key", () => {
    const { payload } = emitWebflow('<h1 class="title">Hi</h1>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.type).toBe("Heading");
    expect(node.tag).toBe("h1");
    expect(node.data.text).toBe(true);
    // Ground-truth wf.json Heading data has no `level` key — dropped.
    expect(node.data.level).toBeUndefined();
  });

  it("test_M7_text_content_preserved_as_flat_text_node_on_heading", () => {
    const html = '<h2 class="offers_heading">Vara tjanstepaket</h2>';
    const { payload } = emitWebflow(html, parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.text).toBe(true);
    expect(node.children).toHaveLength(1);
    const textChild = byId(payload.payload.nodes, node.children[0]);
    expect(isTextNode(textChild)).toBe(true);
    if (!isTextNode(textChild)) throw new Error("expected text child");
    expect(textChild.text).toBe(true);
    expect(textChild.v).toBe("Vara tjanstepaket");
    expect(typeof textChild._id).toBe("string");
    expect(textChild._id.length).toBeGreaterThan(0);
    expect("type" in textChild).toBe(false);
  });

  it("test_M7_text_content_preserved_on_paragraph_with_no_tag_key", () => {
    const { payload } = emitWebflow('<p class="lead">Hello world</p>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.type).toBe("Paragraph");
    expect(node.data.tag).toBeUndefined();
    expect(node.children).toHaveLength(1);
    const textChild = byId(payload.payload.nodes, node.children[0]);
    if (!isTextNode(textChild)) throw new Error("expected text child");
    expect(textChild.v).toBe("Hello world");
  });

  it("test_M7_whitespace_only_text_node_is_skipped", () => {
    const html = `<div class="wrap">\n  <span class="inner">x</span>\n</div>`;
    const { payload } = emitWebflow(html, parseCss(""));
    const node = firstNode(payload.payload.nodes);
    // Only the <span> element child — surrounding whitespace text nodes dropped.
    expect(node.children).toHaveLength(1);
    expect(isTextNode(byId(payload.payload.nodes, node.children[0]))).toBe(false);
  });

  it("test_M7_mixed_text_and_inline_element_children_preserve_order_and_text", () => {
    const html = '<p class="mixed">Hello <strong>world</strong>!</p>';
    const { payload } = emitWebflow(html, parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.children.length).toBeGreaterThanOrEqual(2);
    const first = byId(payload.payload.nodes, node.children[0]);
    if (!isTextNode(first)) throw new Error("expected leading text node");
    expect(first.v).toBe("Hello ");
    const last = byId(payload.payload.nodes, node.children[node.children.length - 1]);
    if (!isTextNode(last)) throw new Error("expected trailing text node");
    expect(last.v).toBe("!");
  });

  it("test_AS_092_nested_elements_produce_correct_children_ids_in_flat_array", () => {
    const html = `
      <div class="parent">
        <p class="child-a">a</p>
        <span class="child-b">b</span>
      </div>
    `;
    const { payload } = emitWebflow(html, parseCss(""));
    const root = firstNode(payload.payload.nodes);
    expect(classNames(payload.payload.styles, root)).toEqual(["parent"]);
    expect(root.children).toHaveLength(2);
    const childA = byId(payload.payload.nodes, root.children[0]);
    const childB = byId(payload.payload.nodes, root.children[1]);
    if (isTextNode(childA) || isTextNode(childB)) throw new Error("expected element children");
    expect(childA.type).toBe("Paragraph");
    expect(classNames(payload.payload.styles, childA)).toEqual(["child-a"]);
    expect(childB.type).toBe("Block");
    expect(classNames(payload.payload.styles, childB)).toEqual(["child-b"]);
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
    const root = firstNode(payload.payload.nodes);
    expect(root.children).toHaveLength(1);
    const child = byId(payload.payload.nodes, root.children[0]);
    if (isTextNode(child)) throw new Error("expected element child");
    expect(child.type).toBe("Paragraph");
  });

  it("test_AS_093_data_attributes_carry_through_as_xattr_reserved_attrs_excluded", () => {
    const html =
      '<div class="card" id="hero" style="color:red" href="#" src="x.png" alt="pic" target="_blank" data-foo="bar" data-baz="qux"></div>';
    const { payload } = emitWebflow(html, parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.xattr).toEqual([
      { name: "id", value: "hero" },
      { name: "data-foo", value: "bar" },
      { name: "data-baz", value: "qux" },
    ]);
  });

  it("test_AS_091_id_attribute_round_trips_as_xattr_entry", () => {
    const { payload } = emitWebflow('<section id="hero"></section>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.xattr).toContainEqual({ name: "id", value: "hero" });
  });

  it("test_AS_094_root_node_ordering_preserved", () => {
    const html = '<section class="one"></section><div class="two"></div>';
    const { payload } = emitWebflow(html, parseCss(""));
    expect(payload.payload.nodes).toHaveLength(2);
    const n0 = firstNode(payload.payload.nodes);
    const n1 = payload.payload.nodes[1] as WebflowNode;
    expect(classNames(payload.payload.styles, n0)).toEqual(["one"]);
    expect(classNames(payload.payload.styles, n1)).toEqual(["two"]);
  });

  it("test_AS_047_inline_style_attribute_produces_warning_during_node_walk", () => {
    const { warnings } = emitWebflow('<div class="card" style="color:red"></div>', parseCss(""));
    expect(warnings.some((w) => w.includes("inline style"))).toBe(true);
  });

  it("no inline style warning when style attribute is absent", () => {
    const { warnings } = emitWebflow('<div class="card"></div>', parseCss(""));
    expect(warnings.some((w) => w.includes("inline style"))).toBe(false);
  });

  it("test_AS_091_uppercase_ID_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<div ID="hero"></div>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.xattr).toContainEqual({ name: "id", value: "hero" });
  });

  it("test_AS_091_uppercase_CLASS_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<div CLASS="card featured"></div>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(classNames(payload.payload.styles, node)).toEqual(["card", "featured"]);
  });

  it("test_AS_091_uppercase_STYLE_attribute_handled_identically_to_lowercase", () => {
    const { warnings } = emitWebflow('<div class="card" STYLE="color:red"></div>', parseCss(""));
    expect(warnings.some((w) => w.includes("inline style"))).toBe(true);
  });

  it("test_AS_091_uppercase_HREF_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<a HREF="https://example.com">link</a>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.link).toMatchObject({ url: "https://example.com" });
  });

  it("test_AS_091_uppercase_DATA_FOO_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<div class="card" DATA-FOO="bar"></div>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.xattr).toContainEqual({ name: "data-foo", value: "bar" });
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

  it("test_AS_117_combo_class_input_produces_base_style_children_containing_combo_id", () => {
    const cssMap = parseCss(".card { color: red; } .card.is-featured { color: blue; }");
    const { payload } = emitWebflow('<div class="card is-featured"></div>', cssMap);
    const base = payload.payload.styles.find((s) => s.name === "card" && s.comb === "")!;
    const combo = payload.payload.styles.find((s) => s.name === "is-featured" && s.comb === "&")!;
    expect(base).toBeDefined();
    expect(combo).toBeDefined();
    expect(base.children).toContain(combo._id);
  });

  it("test_AS_117_three_level_combo_chain_resolves_parent_to_composite_base_not_standalone", () => {
    // .a.b.c must attach to the .a.b combo (composite key "a|b"), not to the
    // standalone .b style — regression guard for the bare-name lookup bug.
    const cssMap = parseCss(
      ".a { color: red; } .b { color: green; } .a.b { color: blue; } .a.b.c { color: yellow; }"
    );
    const { payload } = emitWebflow('<div class="a b c"></div>', cssMap);
    const standaloneB = payload.payload.styles.find((s) => s.name === "b" && s.comb === "")!;
    const comboAB = payload.payload.styles.find((s) => s.name === "b" && s.comb === "&")!;
    const comboABC = payload.payload.styles.find((s) => s.name === "c" && s.comb === "&")!;

    expect(standaloneB).toBeDefined();
    expect(comboAB).toBeDefined();
    expect(comboABC).toBeDefined();

    // .a.b.c's parent must be the .a.b combo, never the standalone .b.
    expect(comboAB.children).toContain(comboABC._id);
    expect(standaloneB.children).not.toContain(comboABC._id);
  });

  it("AS-117: combo class with missing intermediate base gets a synthesized stub instead of being dropped", () => {
    const cssMap = parseCss(".a { color: red; } .a.b.c { color: yellow; }");
    const { payload, warnings } = emitWebflow('<div class="a b c"></div>', cssMap);

    const a = payload.payload.styles.find((s) => s.name === "a" && s.comb === "")!;
    const stubAB = payload.payload.styles.find((s) => s.name === "b" && s.comb === "&")!;
    const comboABC = payload.payload.styles.find((s) => s.name === "c")!;

    expect(a).toBeDefined();
    expect(stubAB).toBeDefined();
    expect(stubAB.styleLess).toBe("");
    expect(a.children).toContain(stubAB._id);

    expect(comboABC).toBeDefined();
    expect(comboABC.styleLess).toBe("color: yellow;");
    expect(comboABC.comb).toBe("&");
    expect(stubAB.children).toContain(comboABC._id);

    for (const s of payload.payload.styles) {
      if (s.comb === "&") {
        const owners = payload.payload.styles.filter((o) => o.children.includes(s._id));
        expect(owners.length).toBe(1);
      }
    }

    expect(warnings.some((w) => w.includes("has no style definition"))).toBe(false);
  });

  it("test_AS_117_missing_intermediate_synthesized_no_null_payload_no_errors", () => {
    const cssMap = parseCss(".a { color: red; } .a.b.c { color: blue; }");
    const { payload, warnings } = emitWebflow('<div class="a b c"></div>', cssMap);
    expect(payload).not.toBeNull();
    expect(warnings.some((w) => w.includes("has no style definition"))).toBe(false);
    const comboABC = payload.payload.styles.find((s) => s.name === "c" && s.styleLess === "color: blue;");
    expect(comboABC).toBeDefined();
  });

  it("test_AS_117_four_level_combo_chain_every_comb_resolves_to_an_existing_style", () => {
    const cssMap = parseCss(".a { color: red; } .a.b.c { color: green; } .a.b.c.d { color: blue; }");
    const { payload, warnings } = emitWebflow('<div class="a b c d"></div>', cssMap);

    expect(payload).not.toBeNull();
    for (const s of payload.payload.styles) {
      if (s.comb === "&") {
        const owners = payload.payload.styles.filter((o) => o.children.includes(s._id));
        expect(owners.length).toBe(1);
      }
    }
    expect(warnings.some((w) => w.includes("references unknown base"))).toBe(false);
    expect(warnings.some((w) => w.includes("has no style definition"))).toBe(false);

    const comboD = payload.payload.styles.find((s) => s.name === "d")!;
    const comboC = payload.payload.styles.find((s) => s.name === "c" && s.styleLess === "color: green;")!;
    expect(comboC.children).toContain(comboD._id);
  });

  it("test_AS_117_truly_broken_three_level_chain_gracefully_skips_with_warning_not_null_payload", () => {
    const cssMap = parseCss(".a.b.c.d { color: yellow; }");
    const { payload, warnings } = emitWebflow('<div class="a b c d"></div>', cssMap);

    expect(payload).not.toBeNull();
    expect(warnings.some((w) => w.includes("has no style definition"))).toBe(true);
  });

  it("test_AS_117_two_level_combo_chain_still_resolves_correctly", () => {
    const cssMap = parseCss(".card { color: red; } .card.is-featured { color: blue; }");
    const { payload } = emitWebflow('<div class="card is-featured"></div>', cssMap);
    const base = payload.payload.styles.find((s) => s.name === "card" && s.comb === "")!;
    const combo = payload.payload.styles.find((s) => s.name === "is-featured" && s.comb === "&")!;
    expect(base.children).toContain(combo._id);
  });

  it("test_AS_041_hover_pseudo_state_variant_maps_onto_webflow_hover_slot", () => {
    const cssMap = parseCss(".btn { color: red; } .btn:hover { color: blue; }");
    const { payload } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.hover).toBeDefined();
    expect(style.variants.hover?.styleLess).toBe("color: blue;");
  });

  it("test_AS_041_active_pseudo_state_variant_maps_onto_webflow_pressed_slot", () => {
    const cssMap = parseCss(".btn { color: red; } .btn:active { color: blue; }");
    const { payload } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.pressed).toBeDefined();
    expect(style.variants.pressed?.styleLess).toBe("color: blue;");
  });

  it("test_AS_041_focus_pseudo_state_variant_maps_onto_webflow_focused_slot", () => {
    const cssMap = parseCss(".btn { color: red; } .btn:focus { color: green; }");
    const { payload } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.focused).toBeDefined();
    expect(style.variants.focused?.styleLess).toBe("color: green;");
  });

  it("test_AS_041_focus_visible_pseudo_state_maps_onto_webflow_focused_visible_slot", () => {
    const cssMap = parseCss(".btn { color: red; } .btn:focus-visible { color: green; }");
    const { payload } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect((style.variants as Record<string, unknown>)["focused-visible"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["focused-visible"]).styleLess).toBe("color: green;");
  });

  it("test_AS_041_before_pseudo_state_maps_onto_webflow_before_slot", () => {
    const cssMap = parseCss(".icon { color: red; } .icon::before { content: ''; }");
    const { payload } = emitWebflow('<span class="icon"></span>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "icon")!;
    expect(style.variants.before).toBeDefined();
    expect(style.variants.before?.styleLess).toBeTruthy();
  });

  it("test_AS_041_after_pseudo_state_maps_onto_webflow_after_slot", () => {
    const cssMap = parseCss(".icon { color: red; } .icon::after { content: ''; }");
    const { payload } = emitWebflow('<span class="icon"></span>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "icon")!;
    expect(style.variants.after).toBeDefined();
    expect(style.variants.after?.styleLess).toBeTruthy();
  });

  it("test_AS_041_visited_pseudo_state_maps_onto_main_visited_slot", () => {
    const cssMap = parseCss(".link { color: red; } .link:visited { color: purple; }");
    const { payload } = emitWebflow('<a class="link"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "link")!;
    expect((style.variants as Record<string, unknown>)["main_visited"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["main_visited"]).styleLess).toBeTruthy();
  });

  it("test_AS_041_placeholder_pseudo_state_maps_onto_main_placeholder_slot", () => {
    const cssMap = parseCss(".input { color: red; } .input::placeholder { color: gray; }");
    const { payload } = emitWebflow('<input class="input">', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "input")!;
    expect((style.variants as Record<string, unknown>)["main_placeholder"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["main_placeholder"]).styleLess).toBeTruthy();
  });

  it("test_AS_041_focus_and_focus_visible_both_survive_as_separate_slots", () => {
    const cssMap = parseCss(".btn { color: black; } .btn:focus { color: red; } .btn:focus-visible { color: blue; }");
    const { payload } = emitWebflow('<button class="btn"></button>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.focused).toBeDefined();
    expect(style.variants.focused?.styleLess).toBe("color: red;");
    expect((style.variants as Record<string, unknown>)["focused-visible"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["focused-visible"]).styleLess).toBe("color: blue;");
  });

  it("test_AS_041_breakpoint_plus_state_emits_composite_key_not_dropped", () => {
    const cssMap = parseCss(`
      .btn { color: red; }
      @media (max-width: 991px) { .btn:hover { color: green; } }
    `);
    const { payload, warnings } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect((style.variants as Record<string, unknown>)["medium_hover"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_hover"]).styleLess).toBe("color: green;");
    expect(warnings.some((w) => w.includes("not representable"))).toBe(false);
  });

  it("test_AS_041_breakpoint_plus_visited_emits_medium_visited_not_medium_main_visited", () => {
    const cssMap = parseCss(`
      .link { color: red; }
      @media (max-width: 991px) { .link:visited { color: purple; } }
    `);
    const { payload, warnings } = emitWebflow('<a class="link"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "link")!;
    expect((style.variants as Record<string, unknown>)["medium_visited"]).toBeDefined();
    expect((style.variants as Record<string, unknown>)["medium_main_visited"]).toBeUndefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_visited"]).styleLess).toBeTruthy();
    expect(warnings.some((w) => w.includes("not representable"))).toBe(false);
  });

  it("test_AS_041_breakpoint_plus_placeholder_emits_medium_placeholder_not_medium_main_placeholder", () => {
    const cssMap = parseCss(`
      .input { color: red; }
      @media (max-width: 991px) { .input::placeholder { color: gray; } }
    `);
    const { payload, warnings } = emitWebflow('<input class="input">', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "input")!;
    expect((style.variants as Record<string, unknown>)["medium_placeholder"]).toBeDefined();
    expect((style.variants as Record<string, unknown>)["medium_main_placeholder"]).toBeUndefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_placeholder"]).styleLess).toBeTruthy();
    expect(warnings.some((w) => w.includes("not representable"))).toBe(false);
  });

  it("test_AS_041_breakpoint_plus_hover_collision_does_not_leak_hover_into_unconditional_breakpoint_slot", () => {
    const cssMap = parseCss(`
      .btn { color: red; }
      .btn:hover { color: blue; }
      @media (max-width: 991px) { .btn:hover { color: green; } }
    `);
    const { payload, warnings } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.hover).toBeDefined();
    expect(style.variants.hover?.styleLess).toBe("color: blue;");
    expect(style.variants.medium).toBeUndefined();
    expect((style.variants as Record<string, unknown>)["medium_hover"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_hover"]).styleLess).toBe("color: green;");
    expect(warnings.some((w) => w.includes("not representable"))).toBe(false);
  });

  it("test_AS_041_two_media_rules_for_same_breakpoint_merge_without_duplicate_or_clobber", () => {
    const cssMap = parseCss(`
      .btn { color: red; }
      @media (max-width: 991px) { .btn { color: blue; } }
      @media (max-width: 991px) { .btn { font-size: 12px; } }
    `);
    const { payload } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.medium).toBeDefined();
    expect(style.variants.medium?.styleLess).toBe("color: blue; font-size: 12px;");
  });

  it("test_AS_041_media_base_plus_media_hover_leaves_medium_styleless_with_only_base_declarations", () => {
    const cssMap = parseCss(`
      .btn { color: red; }
      @media (max-width: 991px) { .btn { color: blue; } }
      @media (max-width: 991px) { .btn:hover { color: green; } }
    `);
    const { payload, warnings } = emitWebflow('<a class="btn"></a>', cssMap);
    const style = payload.payload.styles.find((s) => s.name === "btn")!;
    expect(style.variants.medium).toBeDefined();
    expect(style.variants.medium?.styleLess).toBe("color: blue;");
    expect((style.variants as Record<string, unknown>)["medium_hover"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_hover"]).styleLess).toBe("color: green;");
    expect(warnings.some((w) => w.includes("not representable"))).toBe(false);
  });

  it("aggregates F012/F014 selector and unsupported-@media warnings into the same warnings list", () => {
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
    const node = firstNode(payload.payload.nodes);
    expect(classNames(payload.payload.styles, node)).toEqual(["card"]);
    expect(payload.payload.styles[0].name).toBe("card");
  });
});

describe("emitWebflow — buildStyleBlock crash regression", () => {
  it("test_every_emitted_style_has_type_class", () => {
    const cssMap = parseCss(".card { color: red; } .card.is-featured { color: blue; } .wrapper {}");
    const { payload } = emitWebflow(
      '<div class="card is-featured wrapper stub-only"></div>',
      cssMap
    );
    expect(payload.payload.styles.length).toBeGreaterThan(0);
    for (const style of payload.payload.styles) {
      expect(style.type).toBe("class");
    }
  });
});

describe("emitWebflow — AS-111 XscpData envelope", () => {
  it("test_AS_111_emitted_payload_includes_webflow_xscpdata_type", () => {
    const { payload } = emitWebflow('<div class="card"></div>', parseCss(""));
    expect(payload.type).toBe("@webflow/XscpData");
  });
});

describe("emitWebflow — AS-114 stub styles for classes with no CSS rule", () => {
  it("test_AS_114_class_with_no_css_rule_gets_stub_style_alongside_styled_class", () => {
    const cssMap = parseCss(".wrapper { color: red; }");
    const { payload } = emitWebflow('<div class="wrapper w-container"></div>', cssMap);

    const wrapper = payload.payload.styles.find((s) => s.name === "wrapper");
    const stub = payload.payload.styles.find((s) => s.name === "w-container");

    expect(wrapper).toBeDefined();
    expect(wrapper!.styleLess).toBe("color: red;");

    expect(stub).toBeDefined();
    expect(stub!.styleLess).toBe("");
    expect(stub!.fake).toBe(false);
    expect(stub!.comb).toBe("");
    expect(stub!.variants).toEqual({});
  });

  it("test_AS_114_class_with_no_css_at_all_gets_a_stub_style", () => {
    const cssMap = parseCss("");
    const { payload } = emitWebflow('<div class="js-trigger"></div>', cssMap);

    expect(payload.payload.styles).toHaveLength(1);
    const stub = payload.payload.styles[0];
    expect(stub.name).toBe("js-trigger");
    expect(stub.styleLess).toBe("");
    expect(stub.fake).toBe(false);
    expect(stub.comb).toBe("");
    expect(stub.variants).toEqual({});
  });

  it("test_AS_114_no_warning_is_emitted_for_a_class_with_no_matching_css_rule", () => {
    const cssMap = parseCss("");
    const { warnings } = emitWebflow('<div class="js-trigger"></div>', cssMap);
    expect(warnings.some((w) => w.toLowerCase().includes("js-trigger"))).toBe(false);
  });
});

describe("emitWebflow — ground-truth shape conformance (wf.json)", () => {
  it("test_wf_json_nodes_array_is_flat_no_nested_children_objects", () => {
    const html = '<section class="hero"><div class="inner"><p class="text">Hi</p></div></section>';
    const { payload } = emitWebflow(html, parseCss(""));
    for (const node of payload.payload.nodes) {
      if (isTextNode(node)) continue;
      for (const childId of node.children) {
        expect(typeof childId).toBe("string");
      }
    }
    // 3 element nodes + 1 text node
    expect(payload.payload.nodes).toHaveLength(4);
  });

  it("test_wf_json_classes_are_style_ids_not_names", () => {
    const cssMap = parseCss(".hero { color: red; }");
    const { payload } = emitWebflow('<section class="hero"></section>', cssMap);
    const node = firstNode(payload.payload.nodes);
    const styleIds = new Set(payload.payload.styles.map((s) => s._id));
    for (const cls of node.classes) {
      expect(styleIds.has(cls)).toBe(true);
      expect(cls).not.toBe("hero");
    }
  });

  it("test_wf_json_element_node_data_has_all_seven_common_keys", () => {
    const html = '<section class="hero"><div class="inner"></div></section>';
    const { payload } = emitWebflow(html, parseCss(""));
    for (const node of payload.payload.nodes) {
      if (isTextNode(node)) continue;
      expect(node.data.devlink).toEqual({ runtimeProps: {}, slot: "" });
      expect(node.data.displayName).toBe("");
      expect(node.data.attr).toEqual({ id: "" });
      expect(Array.isArray(node.data.xattr)).toBe(true);
      expect(node.data.search).toEqual({ exclude: false });
      expect(node.data.visibility).toEqual({ conditions: [], keepInHtml: { tag: "False", val: {} } });
      expect(node.data.eventIds).toEqual([]);
    }
  });

  it("test_wf_json_payload_has_expandUserComponents_true", () => {
    const { payload } = emitWebflow('<div class="card"></div>', parseCss(""));
    expect(payload.payload.expandUserComponents).toBe(true);
  });

  it("test_wf_json_section_node_has_no_text_key", () => {
    const { payload } = emitWebflow('<section class="hero"></section>', parseCss(""));
    const node = firstNode(payload.payload.nodes);
    expect(node.data.text).toBeUndefined();
    expect(node.data.tag).toBe("section");
  });

  it("test_wf_json_styles_have_origin_and_selector_null_no_categories", () => {
    const cssMap = parseCss(".card { color: red; }");
    const { payload } = emitWebflow('<div class="card"></div>', cssMap);
    for (const style of payload.payload.styles) {
      expect(style.origin).toBeNull();
      expect(style.selector).toBeNull();
      expect("categories" in style).toBe(false);
    }
  });
});
