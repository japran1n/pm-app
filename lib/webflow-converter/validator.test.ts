import { describe, expect, it } from "vitest";
import { validatePayload } from "./validator";
import type { WebflowNode, WebflowStyle, XscpPayload } from "./emit";

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

describe("validatePayload", () => {
  it("AS-111/AS-112/AS-119: valid minimal payload is valid with no errors", () => {
    const payload = makePayload({
      nodes: [makeNode()],
      styles: [makeStyle()],
    });

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("AS-111: node missing _id is invalid", () => {
    const payload = makePayload({
      nodes: [makeNode({ _id: "" })],
    });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("_id"))).toBe(true);
  });

  it("AS-113: node with unknown type produces a warning, not an error", () => {
    const payload = makePayload({
      nodes: [makeNode({ type: "SomeFutureWebflowType" })],
    });

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes("SomeFutureWebflowType"))).toBe(true);
  });

  it("AS-114: node missing type is an error", () => {
    const payload = makePayload({
      nodes: [makeNode({ type: "" })],
    });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  it("AS-115: invalid class name starting with a number is invalid", () => {
    const payload = makePayload({
      styles: [makeStyle({ name: "1-bad-class" })],
    });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("1-bad-class"))).toBe(true);
  });

  it("AS-116: styleLess must be a string when present", () => {
    const payload = makePayload({
      styles: [makeStyle({ styleLess: 42 as unknown as string })],
    });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
  });

  it("AS-117: no circular references — a node that is its own ancestor is invalid", () => {
    const child = makeNode({ _id: "child" });
    const parent = makeNode({ _id: "parent", children: [child] });
    // introduce a cycle: child points back to parent
    child.children.push(parent);

    const payload = makePayload({ nodes: [parent] });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("circular"))).toBe(true);
  });

  it("AS-118: empty nodes array is a valid empty document", () => {
    const payload = makePayload({ nodes: [], styles: [] });

    const result = validatePayload(payload);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("AS-118: payload.nodes being null is invalid", () => {
    const payload = makePayload({ nodes: null as unknown as WebflowNode[] });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("payload.nodes"))).toBe(true);
  });

  it("AS-118: payload.styles being null is invalid", () => {
    const payload = makePayload({ styles: null as unknown as WebflowStyle[] });

    const result = validatePayload(payload);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("payload.styles"))).toBe(true);
  });

  it("AS-119: when errors are present, valid is always false — no escape hatch", () => {
    const payload = makePayload({
      nodes: [makeNode({ _id: "" })],
      styles: [makeStyle({ name: "9bad" })],
    });

    const result = validatePayload(payload);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.valid).toBe(false);
  });
});
