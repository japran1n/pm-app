import { describe, expect, it } from "vitest";
import { validatePayload } from "./validator";
import type { WebflowNode, WebflowStyle, XscpPayload } from "./emit";

const WEBFLOW_TYPE = "@webflow/XscpData";

function makeNode(overrides: Partial<WebflowNode> = {}): WebflowNode {
  return {
    _id: "node-1",
    type: "Block",
    tag: "div",
    classes: [],
    children: [],
    data: {},
    v: 1,
    ...overrides,
  };
}

function makeStyle(overrides: Partial<WebflowStyle> = {}): WebflowStyle {
  return {
    _id: "style-1",
    name: "my-class",
    fake: false,
    comb: "",
    namespace: "",
    categories: [],
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
        nodes: [makeNode({ classes: ["1-bad-class"] })],
        styles: [makeStyle({ name: "1-bad-class" })],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("1-bad-class"))).toBe(true);
  });

  it("styleLess must be a string when present", () => {
    const payload = withType(
      makePayload({
        nodes: [makeNode({ classes: ["my-class"] })],
        styles: [makeStyle({ styleLess: 42 as unknown as string })],
      })
    );

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  it("AS-113: a node that is its own ancestor (circular child reference) is invalid", () => {
    const child = makeNode({ _id: "child" });
    const parent = makeNode({ _id: "parent", children: [child] });
    // introduce a cycle: child points back to parent
    child.children.push(parent);

    const payload = withType(makePayload({ nodes: [parent], styles: [] }));

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

  describe("AS-114: every node class reference must resolve to a style entry", () => {
    it("rejects a node referencing an unknown class with a specific error", () => {
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["ghost-class"] })],
          styles: [makeStyle({ _id: "style-1", name: "my-class" })],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('references class "ghost-class"'))).toBe(true);
    });

    it("rejects a class reference when there are no styles at all", () => {
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["ghost-class"] })],
          styles: [],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('references class "ghost-class"'))).toBe(true);
    });
  });

  describe("AS-116: no two style definitions may share the same _id", () => {
    it("rejects duplicate style _ids with a specific error", () => {
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["a-class"] })],
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
      const combo = makeStyle({ _id: "combo", name: "combo-class", comb: "base" });
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["base-class", "combo-class"] })],
          styles: [base, combo],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('not registered in base "base"'))).toBe(true);
    });

    it("rejects a combo style whose base does not exist", () => {
      const combo = makeStyle({ _id: "combo", name: "combo-class", comb: "missing-base" });
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["combo-class"] })],
          styles: [combo],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("unknown base"))).toBe(true);
    });

    it("accepts a combo style correctly registered in its base's children", () => {
      const base = makeStyle({ _id: "base", name: "base-class", children: ["combo"] });
      const combo = makeStyle({ _id: "combo", name: "combo-class", comb: "base" });
      const payload = withType(
        makePayload({
          nodes: [makeNode({ classes: ["base-class", "combo-class"] })],
          styles: [base, combo],
        })
      );

      const result = validatePayload(payload);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});
