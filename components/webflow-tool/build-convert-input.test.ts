import { expect, it } from "vitest";

import { buildConvertInput } from "./build-convert-input";
import { convert } from "../../lib/webflow-converter/convert";

// AS-016: JS-tab content is injected as a <script> block
it("test_AS_016_js_tab_content_injected_as_script_block", () => {
  const html = "<div>hi</div>";
  const js = 'console.log("test")';
  const combined = buildConvertInput(html, js);
  expect(combined).toContain("<script>");
  expect(combined).toContain('console.log("test")');
  // Verify convert() picks it up
  const result = convert(combined, "");
  expect(result.customCode.scripts).toHaveLength(1);
  expect(result.customCode.scripts[0]).toContain('console.log("test")');
});

it("test_AS_016_empty_js_returns_html_unchanged", () => {
  const html = "<div>hi</div>";
  expect(buildConvertInput(html, "")).toBe(html);
  expect(buildConvertInput(html, "  ")).toBe(html);
});

// AS-015: inline <style> in HTML tab flows through (engine-level, just verify)
it("test_AS_015_inline_style_in_html_tab_flows_through_convert", () => {
  const html = '<style>.box{color:red}</style><div class="box">hi</div>';
  const combined = buildConvertInput(html, "");
  const result = convert(combined, "");
  expect(result.payload).not.toBeNull();
  const style = result.payload?.payload.styles.find(s => s.name === "box");
  expect(style?.styleLess).toContain("color: red");
});
