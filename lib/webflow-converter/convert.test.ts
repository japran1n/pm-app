import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { convert, convertFromSource } from "./convert";
import type { WebflowNode, WebflowStyle } from "./emit";

describe("convert", () => {
  it("converts simple HTML + CSS into a valid payload with no errors", () => {
    const html = `<div class="wrapper"><h1 class="title">Hello</h1></div>`;
    const css = `.wrapper { display: flex; } .title { color: red; }`;

    const result = convert(html, css);

    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    expect(result.payload!.payload.nodes.length).toBe(1);
    expect(result.payload!.payload.styles.length).toBeGreaterThan(0);
  });

  it("converts class-free HTML only (no CSS) into a valid payload", () => {
    const html = `<div><p>Text</p></div>`;

    const result = convert(html, "");

    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    expect(result.payload!.payload.styles).toEqual([]);
  });

  it("AS-116: combo .btn.primary produces exactly one style named primary — the combo, not a phantom standalone", () => {
    const result = convert('<div class="btn primary">x</div>', ".btn.primary { color: red; }");
    expect(result.payload).not.toBeNull();
    const primaryStyles = result.payload!.payload.styles.filter((s) => s.name === "primary");
    expect(primaryStyles).toHaveLength(1);
    expect(primaryStyles[0].comb).not.toBe("");
    expect(primaryStyles[0].styleLess).toBe("color: red;");
    expect(result.errors).toHaveLength(0);
  });

  it("AS-112: empty HTML string returns a null payload with an error (nodes must not be empty)", () => {
    const result = convert("", "");

    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("must not be empty"))).toBe(true);
  });

  it("AS-112: HTML that is only a comment returns a null payload, consistent with empty HTML", () => {
    const result = convert("<!-- comment -->", "");

    expect(result.payload).toBeNull();
    expect(result.errors.some((e) => e.includes("must not be empty"))).toBe(true);
  });

  it("AS-114: HTML with an unresolved class name (no matching CSS) returns a null payload", () => {
    const result = convert(`<div class="ghost"></div>`, "");

    expect(result.payload).toBeNull();
    expect(result.errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("AS-114: unresolved class at depth 1 also fails, consistent with depth 0", () => {
    const result = convert(`<div class="outer"><p class="ghost">x</p></div>`, "");

    expect(result.payload).toBeNull();
    expect(result.errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("AS-112: class-free empty div still passes because it has 1 node", () => {
    const result = convert(`<div></div>`, "");

    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
  });

  it("extracts scripts from inline blocks, and merges inline <style> CSS into the style model rather than custom code (AS-089)", () => {
    const html = `
      <div class="box"></div>
      <style>.box { color: blue; }</style>
      <script>console.log('hi');</script>
    `;

    const result = convert(html, "");

    expect(result.customCode.scripts).toEqual(["console.log('hi');"]);
    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    expect((result.customCode as { styles?: unknown }).styles).toBeUndefined();
    const boxStyle = result.payload!.payload.styles.find((s) => s.name === "box");
    expect(boxStyle).toBeDefined();
    expect(boxStyle!.styleLess).toContain("color: blue");
  });

  it("AS-089: merges an inline <style> block into the style model when no css argument is passed", () => {
    const html = `<style>.inline-only{color:red}</style><div class="inline-only"></div>`;

    const result = convert(html, "");

    expect(result.errors).toEqual([]);
    const style = result.payload!.payload.styles.find((s) => s.name === "inline-only");
    expect(style).toBeDefined();
    expect(style!.styleLess).toContain("color: red");
  });

  it("AS-089: combines a css argument AND inline <style> blocks — both resolve into styles", () => {
    const html = `<style>.from-inline{color:red}</style><div class="from-arg from-inline"></div>`;
    const css = `.from-arg{display:block}`;

    const result = convert(html, css);

    expect(result.errors).toEqual([]);
    const styleNames = result.payload!.payload.styles.map((s) => s.name);
    expect(styleNames).toContain("from-arg");
    expect(styleNames).toContain("from-inline");
  });

  it("AS-051: warns for a CSS class that is defined but never referenced by any node", () => {
    const result = convert(`<div class="used"></div>`, `.used{color:red} .unused{display:block}`);

    expect(result.warnings.some((w) => w.includes('CSS class "unused" is defined but not used'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('CSS class "used" is defined but not used'))).toBe(false);
  });

  it("AS-051: a combo class chain defined in CSS but not carried together by any single element is flagged unused", () => {
    // .btn.mod is a combo of "btn" + "mod", but no single element carries
    // both classes at once (they're on two separate divs), so the combo
    // chain must be reported as unused even though each individual class is.
    const result = convert(`<div class="btn"></div><div class="mod"></div>`, ".btn{} .mod{} .btn.mod{}");

    expect(result.warnings.some((w) => w.includes("btn.mod") || (w.includes("btn") && w.includes("mod")))).toBe(
      true,
    );
  });

  it("AS-051: a combo class chain carried by a single element is not flagged unused", () => {
    // Both "btn" and "mod" are carried together by the same element, so the
    // combo chain .btn.mod counts as used and must not be warned about.
    const result = convert(`<div class="btn mod"></div>`, ".btn{} .mod{} .btn.mod{}");

    expect(result.warnings.some((w) => w.includes("not used"))).toBe(false);
  });

  it("AS-114: an unresolved class on a 3rd-level descendant (div > p > span) returns a null payload", () => {
    const result = convert(`<div><p><span class="deep-ghost">x</span></p></div>`, "");

    expect(result.payload).toBeNull();
    expect(result.errors.some((e) => e.includes("deep-ghost"))).toBe(true);
  });

  it("uses extractStyles via convertFromSource for self-contained HTML documents", () => {
    const html = `
      <html>
        <head><style>.box { color: blue; } .box:hover { color: green; }</style></head>
        <body><div class="box">Content</div></body>
      </html>
    `;

    const result = convertFromSource(html);

    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    const boxStyle = result.payload!.payload.styles.find((s) => s.name === "box");
    expect(boxStyle).toBeDefined();
    expect(boxStyle!.styleLess).toContain("color: blue");
  });

  it("returns a valid payload (no errors) for well-formed input, confirming the success contract", () => {
    const html = `<div class="a"><div class="a"></div></div>`;
    const css = `.a { color: red; }`;

    const result = convert(html, css);

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
  });

  it("AS-119: a node referencing a class with no matching style definition produces a null payload", () => {
    // "ghost" is used in the HTML but never defined in CSS, so the emitted
    // node references a class with no matching style — validatePayload must
    // reject it and convert() must return payload: null unconditionally.
    const result = convert(`<div class="ghost"></div>`, "");

    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("AS-119: empty HTML (no nodes) produces a null payload", () => {
    const result = convert("", "");

    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("must not be empty"))).toBe(true);
  });

  it("AS-119: HTML that is only a comment (no real nodes) produces a null payload", () => {
    const result = convert("<!-- just a comment -->", "");

    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("includes warnings from CSS parsing in the result", () => {
    const html = `<div class="wrapper"></div>`;
    const css = `#not-a-class { color: red; } .wrapper { color: blue; }`;

    const result = convert(html, css);

    expect(result.warnings.some((w) => w.includes("not a plain class selector"))).toBe(true);
    expect(result.payload).not.toBeNull();
  });

  it("de-duplicates warnings", () => {
    const html = `<div class="wrapper"></div><div class="wrapper"></div>`;
    const css = `#a { color: red; } #b { color: red; }`;

    const result = convert(html, css);

    const selectorWarnings = result.warnings.filter((w) => w.includes("not a plain class selector"));
    // Each unique warning string should appear only once even though two
    // selectors independently produce the same-shaped warning text... but
    // since the selector name differs (#a vs #b) they are distinct strings.
    // Just assert no exact-duplicate strings exist in the overall warnings.
    expect(new Set(result.warnings).size).toBe(result.warnings.length);
    expect(selectorWarnings.length).toBeGreaterThan(0);
  });

  it("AS-141: realistic section — nested containers, combo class, hover, two breakpoints", () => {
    const html = `
      <section class="hero">
        <div class="container">
          <h1 class="hero-title">Hello</h1>
          <a class="btn btn--primary" href="#">Get Started</a>
          <ul class="list">
            <li class="list__item">Item 1</li>
          </ul>
        </div>
      </section>
    `;
    const css = `
      .hero { display: flex; padding: 48px 24px; }
      .container { max-width: 1200px; margin: 0 auto; }
      .hero-title { font-size: 48px; color: #111; }
      .btn { display: inline-block; padding: 12px 24px; }
      .btn.btn--primary { background-color: #0070f3; color: #fff; }
      .btn.btn--primary:hover { background-color: #005ac2; }
      .list { list-style: none; }
      .list__item { margin-bottom: 8px; }
      @media (max-width: 991px) {
        .hero { padding: 32px 16px; }
      }
      @media (max-width: 479px) {
        .hero-title { font-size: 32px; }
      }
    `;
    const result = convert(html, css);

    // No errors
    expect(result.errors).toHaveLength(0);

    // Payload has correct type envelope
    expect(result.payload?.type).toBe("@webflow/XscpData");

    // Node count: section > div > (h1 + a + ul > li) = 6 nodes total.
    const flattenNodes = (nodes: WebflowNode[]): WebflowNode[] =>
      nodes.flatMap((n) => [n, ...flattenNodes(n.children ?? [])]);
    const topLevelNodes = result.payload?.payload.nodes ?? [];
    const allNodes = flattenNodes(topLevelNodes);
    expect(allNodes.length).toBe(6);

    // Style count: 8 classes defined (hero, container, hero-title, btn,
    // btn--primary combo, list, list__item — plus the pseudo-state variant
    // is folded into btn--primary's variants, not a separate style entry).
    const styles: WebflowStyle[] = result.payload?.payload.styles ?? [];
    expect(styles.length).toBeGreaterThanOrEqual(7);

    // Combo: btn--primary is a combo of btn; btn.children includes btn--primary._id
    const btnStyle = styles.find((s) => s.name === "btn" && s.comb === "");
    const btnPrimaryStyle = styles.find((s) => s.name === "btn--primary" && s.comb !== "");
    expect(btnStyle).toBeDefined();
    expect(btnPrimaryStyle).toBeDefined();
    expect(btnPrimaryStyle?.comb).toBe(btnStyle?._id);
    expect(btnStyle?.children).toContain(btnPrimaryStyle?._id);

    // Hover variant present on the combo (btn--primary), carrying background-color
    expect(btnPrimaryStyle?.variants).toBeDefined();
    expect(btnPrimaryStyle?.variants.hover).toBeDefined();
    expect(btnPrimaryStyle?.variants.hover?.styleLess).toContain("background-color");

    // Breakpoint variants: hero has a "medium" variant, hero-title has a "tiny" variant
    const heroStyle = styles.find((s) => s.name === "hero");
    expect(heroStyle?.variants).toBeDefined();
    expect(heroStyle?.variants.medium).toBeDefined();
    expect(heroStyle?.variants.medium?.styleLess).toContain("padding");

    const heroTitleStyle = styles.find((s) => s.name === "hero-title");
    expect(heroTitleStyle?.variants).toBeDefined();
    expect(heroTitleStyle?.variants.tiny).toBeDefined();
    expect(heroTitleStyle?.variants.tiny?.styleLess).toContain("font-size");

    // No shorthand in any emitted styleLess (base or variant slots)
    const SHORTHANDS = [
      "font",
      "background",
      "border",
      "margin",
      "padding",
      "flex",
      "grid",
      "transition",
      "animation",
      "outline",
      "list-style",
    ];
    const assertNoShorthand = (styleLess: string | undefined) => {
      if (!styleLess) return;
      const props = styleLess
        .split(";")
        .map((d: string) => d.split(":")[0].trim())
        .filter(Boolean);
      for (const prop of props) {
        expect(SHORTHANDS).not.toContain(prop);
      }
    };
    for (const style of styles) {
      assertNoShorthand(style.styleLess);
      for (const variant of Object.values(style.variants ?? {})) {
        assertNoShorthand((variant as { styleLess?: string })?.styleLess);
      }
    }

    // AS-051: every defined class is used somewhere in the tree, including
    // list__item which only appears on a 3rd-level descendant (li inside ul
    // inside div inside section) — the unused-class check must recurse into
    // all descendant nodes, not just top-level children.
    expect(result.warnings.some((w) => w.includes("not used"))).toBe(false);
  });

  it("AS-011: no Supabase imports anywhere in the webflow-converter module directory or webflow page/component files", () => {
    const dir = join(process.cwd(), "lib", "webflow-converter");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

    for (const file of files) {
      const contents = readFileSync(join(dir, file), "utf-8");
      expect(contents.toLowerCase()).not.toContain("supabase");
    }

    // Extend the scan to app/**/webflow* and components/**/webflow* — the
    // (possibly not-yet-created) converter page/component files that will
    // wire this module into the UI. Walk recursively; skip node_modules.
    const isSourceFile = (name: string) =>
      (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx");

    const collectWebflowFiles = (root: string): string[] => {
      const results: string[] = [];
      const walk = (dirPath: string) => {
        let entries: import("node:fs").Dirent[];
        try {
          entries = readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const fullPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && entry.name.toLowerCase().includes("webflow") && isSourceFile(entry.name)) {
            results.push(fullPath);
          }
        }
      };
      walk(root);
      return results;
    };

    const scanRoots = [join(process.cwd(), "app"), join(process.cwd(), "components")];
    const webflowFiles = scanRoots.flatMap((root) => collectWebflowFiles(root));

    for (const file of webflowFiles) {
      const contents = readFileSync(file, "utf-8");
      expect(contents.toLowerCase()).not.toContain("supabase");
    }
  });

  describe("AS-101 — script passthrough in convert()", () => {
    it("AS-101: external <script src> in HTML is collected in result.customCode.scripts", () => {
      const html = '<div class="box"></div><script async defer type="module" src="/app.js"></script>';
      const css = ".box { color: red; }";
      const result = convert(html, css);
      expect(result.customCode.scripts.length).toBeGreaterThan(0);
      // Must carry the multi-attribute tag verbatim
      const tag = result.customCode.scripts.find((s) => s.includes("src="));
      expect(tag).toBeDefined();
      expect(tag).toContain("async");
      expect(tag).toContain("defer");
      expect(tag).toContain('type="module"');
      expect(tag).toContain("src=");
    });

    it("AS-101: multiple external scripts are all collected, none filtered out", () => {
      const html = [
        '<script src="/a.js"></script>',
        '<div class="box"></div>',
        '<script defer src="/b.js"></script>',
      ].join("");
      const css = ".box { color: red; }";
      const result = convert(html, css);
      expect(result.customCode.scripts.length).toBe(2);
      expect(result.customCode.scripts.some((s) => s.includes("/a.js"))).toBe(true);
      expect(result.customCode.scripts.some((s) => s.includes("/b.js"))).toBe(true);
    });

    it("AS-101: inline <script> body is collected separately from external scripts", () => {
      const html = '<div class="box"></div><script>console.log("hi")</script>';
      const css = ".box { color: red; }";
      const result = convert(html, css);
      expect(result.customCode.scripts.length).toBeGreaterThan(0);
      expect(result.customCode.scripts.some((s) => s.includes("console.log"))).toBe(true);
    });
  });
});
