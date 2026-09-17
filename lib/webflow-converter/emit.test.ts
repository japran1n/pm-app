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
      { name: "id", value: "hero" },
      { name: "data-foo", value: "bar" },
      { name: "data-baz", value: "qux" },
    ]);
  });

  it("test_AS_091_id_attribute_round_trips_as_xattr_entry", () => {
    const { payload } = emitWebflow('<section id="hero"></section>', parseCss(""));
    const node = payload.payload.nodes[0];
    expect(node.data.xattr).toContainEqual({ name: "id", value: "hero" });
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

  it("test_AS_091_uppercase_ID_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<div ID="hero"></div>', parseCss(""));
    const node = payload.payload.nodes[0];
    expect(node.data.xattr).toContainEqual({ name: "id", value: "hero" });
  });

  it("test_AS_091_uppercase_CLASS_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<div CLASS="card featured"></div>', parseCss(""));
    const node = payload.payload.nodes[0];
    expect(node.classes).toEqual(["card", "featured"]);
  });

  it("test_AS_091_uppercase_STYLE_attribute_handled_identically_to_lowercase", () => {
    const { warnings } = emitWebflow('<div class="card" STYLE="color:red"></div>', parseCss(""));
    expect(warnings.some((w) => w.includes("inline style"))).toBe(true);
  });

  it("test_AS_091_uppercase_HREF_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<a HREF="https://example.com">link</a>', parseCss(""));
    const node = payload.payload.nodes[0];
    expect(node.data.link).toMatchObject({ url: "https://example.com" });
  });

  it("test_AS_091_uppercase_DATA_FOO_attribute_handled_identically_to_lowercase", () => {
    const { payload } = emitWebflow('<div class="card" DATA-FOO="bar"></div>', parseCss(""));
    const node = payload.payload.nodes[0];
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
    const combo = payload.payload.styles.find((s) => s.name === "is-featured" && s.comb !== "")!;
    expect(base).toBeDefined();
    expect(combo).toBeDefined();
    expect(combo.comb).toBe(base._id);
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
    const comboAB = payload.payload.styles.find((s) => s.name === "b" && s.comb !== "")!;
    const comboABC = payload.payload.styles.find((s) => s.name === "c" && s.comb !== "")!;

    expect(standaloneB).toBeDefined();
    expect(comboAB).toBeDefined();
    expect(comboABC).toBeDefined();

    // .a.b.c's parent must be the .a.b combo, never the standalone .b.
    expect(comboABC.comb).toBe(comboAB._id);
    expect(comboABC.comb).not.toBe(standaloneB._id);
    expect(comboAB.children).toContain(comboABC._id);
  });

  it("AS-117: combo class with undefined base emits a warning and is not emitted as its own combo entry", () => {
    // .a.b.c defined without .a.b ever being defined in CSS: base can't be
    // found, so buildStyles() skips the unparented combo entirely instead of
    // emitting it with comb:"" (which would make it bind like a standalone
    // class). Since the node still carries class "c" (as part of "a b c"),
    // the AS-114 stub pass then emits a plain stub style for it — same as
    // any other class with no matching CSS rule.
    const cssMap = parseCss(".a { color: red; } .a.b.c { color: yellow; }");
    const { payload, warnings } = emitWebflow('<div class="a b c"></div>', cssMap);
    const comboABC = payload.payload.styles.find((s) => s.name === "c");

    expect(comboABC).toBeDefined();
    expect(comboABC!.styleLess).toBe("");
    expect(comboABC!.comb).toBe("");
    expect(warnings.some((w) => w.includes("has no style definition"))).toBe(true);
    expect(warnings.some((w) => w.includes('base "a.b"'))).toBe(true);
  });

  it("test_AS_117_two_level_combo_chain_still_resolves_correctly", () => {
    const cssMap = parseCss(".card { color: red; } .card.is-featured { color: blue; }");
    const { payload } = emitWebflow('<div class="card is-featured"></div>', cssMap);
    const base = payload.payload.styles.find((s) => s.name === "card" && s.comb === "")!;
    const combo = payload.payload.styles.find((s) => s.name === "is-featured" && s.comb !== "")!;
    expect(combo.comb).toBe(base._id);
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
    // No "not representable" warning
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
    // Default-breakpoint hover slot is preserved
    expect(style.variants.hover).toBeDefined();
    expect(style.variants.hover?.styleLess).toBe("color: blue;");
    // medium breakpoint hover goes to medium_hover, not medium
    expect(style.variants.medium).toBeUndefined();
    expect((style.variants as Record<string, unknown>)["medium_hover"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_hover"]).styleLess).toBe("color: green;");
    // No "not representable" warning anymore
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
    // Hover at medium goes to medium_hover
    expect((style.variants as Record<string, unknown>)["medium_hover"]).toBeDefined();
    expect(((style.variants as Record<string, { styleLess: string }>)["medium_hover"]).styleLess).toBe("color: green;");
    // No warning about "not representable"
    expect(warnings.some((w) => w.includes("not representable"))).toBe(false);
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
