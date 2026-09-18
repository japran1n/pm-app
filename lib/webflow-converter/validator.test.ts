import { describe, expect, it } from "vitest";
import { validatePayload } from "./validator";
import type { WebflowNode, WebflowStyle, XscpPayload } from "./emit";

const WEBFLOW_TYPE = "@webflow/XscpData";

function commonData(): Record<string, unknown> {
  return {
    devlink: { runtimeProps: {}, slot: "" },
    displayName: "",
    attr: { id: "" },
    xattr: [],
    search: { exclude: false },
    visibility: { conditions: [], keepInHtml: { tag: "False", val: {} } },
  };
}

function makeNode(overrides: Partial<WebflowNode> = {}): WebflowNode {
  return {
    _id: "node-1",
    type: "Block",
    tag: "div",
    classes: [],
    children: [],
    data: commonData(),
    ...overrides,
  };
}

function makeStyle(overrides: Partial<WebflowStyle> = {}): WebflowStyle {
  return {
    _id: "style-1",
    fake: false,
    type: "class",
    name: "my-class",
    namespace: "",
    comb: "",
    origin: null,
    selector: null,
    styleLess: "color: red;",
    variants: {},
    children: [],
    ...overrides,
  };
}

function makePayload(overrides: Partial<XscpPayload> = {}): XscpPayload {
  return {
    nodes: [],
    styles: [],
    assets: [],
    ix1: [],
    ix2: { interactions: [], events: [], actionLists: [] },
    expandUserComponents: true,
    ...overrides,
  };
}

/** Attaches the `type` discriminator every valid payload must carry (AS-111). */
function withType(payload: XscpPayload): XscpPayload {
  return { ...payload, type: WEBFLOW_TYPE } as XscpPayload;
}

describe("validatePayload", () => {
  it("AS-111/AS-112/AS-119: valid minimal payload is valid with no errors", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode()],
        styles: [makeStyle()],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("node missing _id is invalid", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ _id: "" })],
        styles: [makeStyle()],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("_id"))).toBe(true);
  });

  it("node with unknown type produces a warning, not an error", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ type: "SomeFutureWebflowType" })],
        styles: [makeStyle()],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("SomeFutureWebflowType"))).toBe(true);
  });

  it("node missing type is an error", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ type: "" })],
        styles: [makeStyle()],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  it("invalid class name starting with a number is invalid", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ classes: ["style-1"] })],
        styles: [makeStyle({ _id: "style-1", name: "1-bad-class" })],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("1-bad-class"))).toBe(true);
  });

  it("styleLess must be a string when present", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ classes: ["style-1"] })],
        styles: [makeStyle({ _id: "style-1", styleLess: 42 as unknown as string })],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  it("node missing a data object is invalid", () => {
    const node = makeNode();
    delete (node as { data?: unknown }).data;
    const payload = withType(makePayload({ nodes: [node], styles: [] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("data object"))).toBe(true);
  });

  it("node data missing a required common key (e.g. devlink) is invalid — the wf.json crash source", () => {
    const node = makeNode();
    delete (node.data as Record<string, unknown>).devlink;
    const payload = withType(makePayload({ nodes: [node], styles: [] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"devlink"'))).toBe(true);
  });

  it("a valid text node ({_id, text: true, v}) passes", () => {
    const payload = withType(makePayload({ nodes: [{ _id: "text-1", text: true, v: "Hello" }], styles: [] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
  });

  it("a text node with a type key is invalid", () => {
    const payload = withType(
      makePayload({ nodes: [{ _id: "text-1", text: true, v: "Hello", type: "text" } as never], styles: [] })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must not have a "type"'))).toBe(true);
  });

  it("a text node missing a string v is invalid", () => {
    const payload = withType(makePayload({ nodes: [{ _id: "text-1", text: true } as never], styles: [] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  it("an element's children entry that does not resolve to any node's _id is invalid", () => {
    const payload = withType(
      makePayload({ nodes: [makeNode({ children: ["ghost-child"] })], styles: [] })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ghost-child"))).toBe(true);
  });

  it("an element's children entry that resolves to a real node's _id is valid", () => {
    const child = makeNode({ _id: "child" });
    const parent = makeNode({ _id: "parent", children: ["child"] });
    const payload = withType(makePayload({ nodes: [parent, child], styles: [] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
  });

  it("AS-113: a node whose children id-chain points back to itself (circular reference) is invalid", () => {
    const child = makeNode({ _id: "child", children: ["parent"] });
    const parent = makeNode({ _id: "parent", children: ["child"] });

    const payload = withType(makePayload({ nodes: [parent, child], styles: [] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("circular"))).toBe(true);
  });

  it("AS-118: payload.nodes being null is invalid and never offered for copy", () => {
    const payload = withType(makePayload({ nodes: null as unknown as WebflowNode[] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("payload.nodes"))).toBe(true);
  });

  it("AS-118: payload.styles being null is invalid and never offered for copy", () => {
    const payload = withType(makePayload({ styles: null as unknown as WebflowStyle[] }));

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("payload.styles"))).toBe(true);
  });

  it("AS-119: when errors are present, valid is always false — no escape hatch", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ _id: "" })],
        styles: [makeStyle({ name: "9bad" })],
      })
    );

    const result = validatePayload(payload);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.valid).toBe(false);
  });

  describe('AS-111: payload must carry type: "@webflow/XscpData"', () => {
    it("rejects a payload with a missing type", () => {
      const payload = makePayload({ nodes: [makeNode()], styles: [makeStyle()] });

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(WEBFLOW_TYPE))).toBe(true);
    });

    it("rejects a payload with the wrong type string", () => {
      const payload = {
        ...makePayload({ nodes: [makeNode()], styles: [makeStyle()] }),
        type: "@webflow/SomethingElse",
      } as XscpPayload;

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes(WEBFLOW_TYPE))).toBe(true);
    });
  });

  describe("AS-112: payload.nodes must not be empty", () => {
    it("rejects an empty nodes array with a specific error", () => {
      const payload = withType(makePayload({ nodes: [], styles: [] }));

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("must not be empty"))).toBe(true);
    });
  });

  describe("AS-114: every node classes entry must resolve to a style _id", () => {
    it("rejects a node referencing an unknown style id with a specific error", () => {
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["ghost-style-id"] })],
          styles: [makeStyle({ _id: "style-1", name: "my-class" })],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('references class id "ghost-style-id"'))).toBe(true);
    });

    it("rejects a class reference when there are no styles at all", () => {
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["ghost-style-id"] })],
          styles: [],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('references class id "ghost-style-id"'))).toBe(true);
    });
  });

  describe("AS-116: no two style definitions may share the same _id", () => {
    it("rejects duplicate style _ids with a specific error", () => {
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["dup"] })],
          styles: [makeStyle({ _id: "dup", name: "a-class" }), makeStyle({ _id: "dup", name: "b-class" })],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes("duplicate style _id"))).toBe(true);
    });
  });

  describe("AS-117: combo classes must be registered in their base's children array", () => {
    it("rejects a combo style whose base does not list it in children", () => {
      const base = makeStyle({ _id: "base", name: "base-class", children: [] });
      const combo = makeStyle({ _id: "combo", name: "combo-class", comb: "&" });
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["base", "combo"] })],
          styles: [base, combo],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("not registered in any base style"))).toBe(true);
    });

    it("rejects a combo style registered in more than one base's children", () => {
      const base1 = makeStyle({ _id: "base1", name: "base-class-1", children: ["combo"] });
      const base2 = makeStyle({ _id: "base2", name: "base-class-2", children: ["combo"] });
      const combo = makeStyle({ _id: "combo", name: "combo-class", comb: "&" });
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["base1", "base2", "combo"] })],
          styles: [base1, base2, combo],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("more than one base style"))).toBe(true);
    });

    it("accepts a combo style correctly registered in its base's children", () => {
      const base = makeStyle({ _id: "base", name: "base-class", children: ["combo"] });
      const combo = makeStyle({ _id: "combo", name: "combo-class", comb: "&" });
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["base", "combo"] })],
          styles: [base, combo],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("crash regression: every style must carry type: \"class\"", () => {
    it("rejects a style missing the type field (buildStyleBlock crash)", () => {
      const style = makeStyle();
      delete (style as { type?: unknown }).type;
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["style-1"] })],
          styles: [style],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type: "class"'))).toBe(true);
    });
  });
});
