import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { convert, convertFromSource } from "./convert";
import { validatePayload } from "./validator";
import { isTextNode, type WebflowNode, type WebflowStyle } from "./emit";

describe("convert", () => {
  it("converts simple HTML + CSS into a valid payload with no errors", () => {
    const html = `<div class="wrapper"><h1 class="title">Hello</h1></div>`;
    const css = `.wrapper { display: flex; } .title { color: red; }`;

    const result = convert(html, css);

    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
    // payload.nodes is flat: div, h1, and h1's text node = 3 entries.
    expect(result.payload!.payload.nodes.length).toBe(3);
    expect(result.payload!.payload.styles.length).toBeGreaterThan(0);
  });

  it("AS-089: a malformed inline <style> block does not blank out styles from the css input", () => {
    const html = `<div class="good">x</div><style>.bad{color:</style>`;
    const css = `.good { color: red; }`;

    const result = convert(html, css);

    expect(result.payload).not.toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes("parse error"))).toBe(true);
    const good = result.payload!.payload.styles.find((s) => s.name === "good");
    expect(good).toBeDefined();
    expect(good!.styleLess).toBe("color: red;");
  });

  it("AS-089: one bad <style> block among several degrades gracefully — the good block's classes still resolve", () => {
    const html = `<div class="good"></div><div class="bad"></div><style>.bad{color:</style><style>.good{color:red}</style>`;

    const result = convert(html, "");

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.toLowerCase().includes("parse error"))).toBe(true);
    const good = result.payload!.payload.styles.find((s) => s.name === "good");
    const bad = result.payload!.payload.styles.find((s) => s.name === "bad");
    expect(good).toBeDefined();
    expect(good!.styleLess).toBe("color: red;");
    expect(bad).toBeDefined();
    expect(bad!.styleLess).toBe("");
  });

  it("AS-117: missing intermediate combo link (.a{} .a.b.c{}) is repaired, not dropped — non-null payload with no errors", () => {
    const html = `<div class="a b c"></div>`;
    const css = `.a { color: red; } .a.b.c { color: blue; }`;

    const result = convert(html, css);

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
    const styles = result.payload!.payload.styles;
    for (const s of styles) {
      if (s.comb === "&") {
        const owners = styles.filter((o) => o.children.includes(s._id));
        expect(owners.length).toBe(1);
      }
    }
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

  it("AS-114: HTML with an unresolved class name (no matching CSS) gets a stub style, not a null payload", () => {
    const result = convert(`<div class="ghost"></div>`, "");

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
    const stub = result.payload!.payload.styles.find((s) => s.name === "ghost");
    expect(stub).toBeDefined();
    expect(stub!.styleLess).toBe("");
  });

  it("AS-114: unresolved class at depth 1 also gets a stub style, consistent with depth 0", () => {
    const result = convert(`<div class="outer"><p class="ghost">x</p></div>`, "");

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
    const stub = result.payload!.payload.styles.find((s) => s.name === "ghost");
    expect(stub).toBeDefined();
    expect(stub!.styleLess).toBe("");
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

  it("AS-114: an unresolved class on a 3rd-level descendant (div > p > span) gets a stub style", () => {
    const result = convert(`<div><p><span class="deep-ghost">x</span></p></div>`, "");

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
    const stub = result.payload!.payload.styles.find((s) => s.name === "deep-ghost");
    expect(stub).toBeDefined();
    expect(stub!.styleLess).toBe("");
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

  it("AS-119: a node referencing a class with no matching style definition gets a stub style, so validation still passes", () => {
    // "ghost" is used in the HTML but never defined in CSS. emitWebflow now
    // emits a stub style for it (AS-114 fix), so validatePayload finds every
    // node class resolves to a style and convert() returns a non-null
    // payload with no errors.
    const result = convert(`<div class="ghost"></div>`, "");

    expect(result.payload).not.toBeNull();
    expect(result.errors).toEqual([]);
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

    // Node count: section > div > (h1 + a + ul > li) = 6 nodes total. No
    // margin/padding properties have a restricted value set under Webflow's
    // moden.club-derived whitelist, so `.container`'s `margin: 0 auto`
    // expansion (margin-right/left: auto) is representable in styleLess and
    // no CSS embed is needed here.
    // payload.nodes is already flat — every element (not text) node is a
    // top-level entry.
    const allNodes = (result.payload?.payload.nodes ?? []).filter((n) => !isTextNode(n)) as WebflowNode[];
    expect(allNodes.length).toBe(6);

    // Style count: 8 classes defined (hero, container, hero-title, btn,
    // btn--primary combo, list, list__item — plus the pseudo-state variant
    // is folded into btn--primary's variants, not a separate style entry).
    const styles: WebflowStyle[] = result.payload?.payload.styles ?? [];
    expect(styles.length).toBeGreaterThanOrEqual(7);

    // Combo: btn--primary is a combo of btn; btn.children includes btn--primary._id
    const btnStyle = styles.find((s) => s.name === "btn" && s.comb === "");
    const btnPrimaryStyle = styles.find((s) => s.name === "btn--primary" && s.comb === "&");
    expect(btnStyle).toBeDefined();
    expect(btnPrimaryStyle).toBeDefined();
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

    // Extend the scan to every source file that makes up the converter
    // feature: components/webflow-tool/, lib/webflow-converter-client/, and
    // the lib/actions/webflow-converter.ts Server Action. Walk recursively;
    // skip node_modules. All .ts/.tsx files in these locations are scanned
    // in full — not just ones whose filename happens to contain "webflow" —
    // because a Server Action or helper file could import Supabase without
    // "webflow" appearing in its own name.
    const isSourceFile = (name: string) =>
      (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx");

    const collectSourceFiles = (root: string): string[] => {
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
          } else if (entry.isFile() && isSourceFile(entry.name)) {
            results.push(fullPath);
          }
        }
      };
      walk(root);
      return results;
    };

    const scanRoots = [
      join(process.cwd(), "components", "webflow-tool"),
      join(process.cwd(), "lib", "webflow-converter-client"),
    ];
    const webflowFiles = [
      ...scanRoots.flatMap((root) => collectSourceFiles(root)),
      // The Server Action that wires the converter into the UI. Scanned
      // directly (not the whole lib/actions/ directory, which also holds
      // unrelated actions that legitimately import Supabase) so this guard
      // stays specific to the webflow-converter feature.
      join(process.cwd(), "lib", "actions", "webflow-converter.ts"),
    ].filter((f) => existsSync(f));

    // Guard the guard: fail loudly if the walk found nothing to check —
    // that would silently pass without actually verifying anything.
    expect(webflowFiles.length).toBeGreaterThan(0);

    for (const file of webflowFiles) {
      const contents = readFileSync(file, "utf-8");
      // Reject any import whose path contains "supabase" (package or
      // internal path) — covers '@supabase/supabase-js', '@/lib/supabase/client',
      // relative paths like '../../../lib/supabase/client', or any other
      // form where the import specifier includes "/supabase/" or "supabase".
      expect(contents.toLowerCase()).not.toMatch(/from\s+['"][^'"]*supabase[^'"]*['"]/);
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

  describe("AS-132 — Tailwind variant class names are downgraded to warnings, not errors", () => {
    it("AS-132: md:w-1/2 produces a warning (not an error) and a non-null payload", () => {
      const html = `<div class="md:w-1/2">x</div>`;
      const css = `.md\\:w-1\\/2 { width: 50%; }`;

      const result = convert(html, css);

      expect(result.payload).not.toBeNull();
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes("md:w-1/2"))).toBe(true);
    });

    it("AS-132: w-[32px] produces a warning (not an error) and a non-null payload", () => {
      const html = `<div class="w-[32px]">x</div>`;
      const css = `.w-\\[32px\\] { width: 32px; }`;

      const result = convert(html, css);

      expect(result.payload).not.toBeNull();
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes("w-[32px]"))).toBe(true);
    });

    it("AS-132: hover:text-blue-500 produces a warning (not an error) and a non-null payload", () => {
      const html = `<div class="hover:text-blue-500">x</div>`;
      const css = `.hover\\:text-blue-500 { color: blue; }`;

      const result = convert(html, css);

      expect(result.payload).not.toBeNull();
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes("hover:text-blue-500"))).toBe(true);
    });

    it("AS-132: a genuinely malformed class name (digit prefix, no colon) still produces a hard error", () => {
      const html = `<div class="ok">x</div>`;
      const css = `.ok { color: red; }`;

      const result = convert(html, css);
      // Directly exercise validatePayload with an injected malformed style
      // name to prove the digit-prefix path still hard-errors and the
      // Tailwind-variant branch did not silently swallow it.
      expect(result.payload).not.toBeNull();
      const payload = result.payload!.payload;
      const mutated = {
        ...payload,
        styles: [
          ...payload.styles,
          {
            _id: "injected-bad-style",
            fake: false,
            type: "class" as const,
            name: "123invalid",
            namespace: "" as const,
            origin: null,
            selector: null,
            comb: "",
            styleLess: "",
            variants: {},
            children: [],
          },
        ],
      };

      const validation = validatePayload(mutated);

      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some((e: string) => e.includes("123invalid") && e.includes("not a valid Webflow class name"))
      ).toBe(true);
    });
  });

  describe("AS-114 — unstyled utility class does not block conversion", () => {
    it("test_AS_114_convert_with_unstyled_class_returns_no_errors_and_non_null_payload", () => {
      const html = '<div class="wrapper w-container">hi</div>';
      const css = ".wrapper { color: red; }";
      const result = convert(html, css);

      expect(result.errors).toEqual([]);
      expect(result.payload).not.toBeNull();
      const styleNames = result.payload!.payload.styles.map((s) => s.name);
      expect(styleNames).toContain("wrapper");
      expect(styleNames).toContain("w-container");
    });
  });

  describe("ground-truth wf.json shape regression — the paste-crash fix", () => {
    it("converting a small section produces a payload matching Webflow Designer's real clipboard shape", () => {
      const html = `
        <section class="team_component">
          <div class="team_top">
            <h2 class="team_heading">Leadership</h2>
            <p class="team_text">Some copy.</p>
          </div>
        </section>
      `;
      const css = `
        .team_component { display: flex; }
        .team_top { display: flex; justify-content: space-between; }
        .team_heading { color: #ffffff; font-size: 3rem; }
        .team_text { max-width: 20rem; color: var(--team-text-secondary, #d6d6d6); }
      `;

      const result = convert(html, css);
      expect(result.errors).toEqual([]);
      const payload = result.payload!.payload;

      // 1. payload.nodes is FLAT — no nested objects under `children`, only id strings.
      for (const node of payload.nodes) {
        if (isTextNode(node)) continue;
        for (const childId of node.children) {
          expect(typeof childId).toBe("string");
        }
      }

      // 2. Every `classes` entry on every element node is a known style `_id`.
      const styleIds = new Set(payload.styles.map((s) => s._id));
      const styleNamesById = new Map(payload.styles.map((s) => [s._id, s.name]));
      let sawResolvedClass = false;
      for (const node of payload.nodes) {
        if (isTextNode(node)) continue;
        for (const cls of node.classes) {
          expect(styleIds.has(cls)).toBe(true);
          sawResolvedClass = true;
        }
      }
      expect(sawResolvedClass).toBe(true);
      // Sanity: classes are ids (resolvable via the map above), not the
      // literal HTML class name — e.g. no node's classes array literally
      // contains the string "team_component".
      const anyLiteralClassName = payload.nodes.some(
        (n) => !isTextNode(n) && (n as WebflowNode).classes.includes("team_component")
      );
      expect(anyLiteralClassName).toBe(false);
      expect(Array.from(styleNamesById.values())).toContain("team_component");

      // 3. Every element node's `data` has all six common keys.
      const COMMON_KEYS = ["devlink", "displayName", "attr", "xattr", "search", "visibility"];
      for (const node of payload.nodes) {
        if (isTextNode(node)) continue;
        for (const key of COMMON_KEYS) {
          expect(node.data).toHaveProperty(key);
        }
      }

      // 4. payload.expandUserComponents === true.
      expect(payload.expandUserComponents).toBe(true);

      // 5. var() with a fallback passes through styleLess verbatim (no crash-prone resolution).
      const teamText = payload.styles.find((s) => s.name === "team_text")!;
      expect(teamText.styleLess).toContain("var(--team-text-secondary, #d6d6d6)");

      // The payload must also pass the validator end to end.
      expect(validatePayload({ ...payload, type: result.payload!.type } as never).valid).toBe(true);
    });
  });
});
