import { describe, expect, test } from "vitest";
import { composeDocument } from '@/lib/code-editor/compose';
import type { Block } from '@/lib/code-editor/compose';
import { STYLE_AGENT_SCRIPT } from '@/lib/site-preview/inject';
import type { StyleBlock, ScriptBlock } from '@/lib/code-editor/extract';

function styleBlock(overrides: Partial<StyleBlock> = {}): StyleBlock {
  return {
    index: 0,
    type: 'style',
    originalContent: 'body { color: red; }',
    content: 'body { color: red; }',
    ...overrides,
  };
}

function scriptBlock(overrides: Partial<ScriptBlock> = {}): ScriptBlock {
  return {
    index: 0,
    type: 'script',
    originalContent: 'console.log("a")',
    content: 'console.log("a")',
    name: 'script-1.js',
    ...overrides,
  };
}

describe('composeDocument', () => {
  // TH-130
  test('TH_130_basic_substitution_replaces_original_with_edited_content', () => {
    const html = '<html><head><style>body { color: red; }</style></head><body></body></html>';
    const block = styleBlock({ content: 'body { color: blue; }' });
    const result = composeDocument(html, [block]);
    expect(result).toContain('body { color: blue; }');
    expect(result).not.toContain('body { color: red; }');
  });

  // TH-131
  test('TH_131_block_not_found_is_appended_before_closing_body', () => {
    const html = '<html><body><p>hi</p></body></html>';
    const block = styleBlock({
      originalContent: '.missing { display: none; }',
      content: '.missing { display: none; }',
    });
    const result = composeDocument(html, [block]);
    expect(result).toContain('<style>.missing { display: none; }</style>');
    const styleIdx = result.indexOf('<style>.missing');
    const bodyCloseIdx = result.indexOf('</body>');
    expect(styleIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeLessThan(bodyCloseIdx);
  });

  // TH-132
  test('TH_132_multiple_blocks_all_substituted', () => {
    const html =
      '<html><head><style>a{color:red;}</style><style>b{color:green;}</style></head>' +
      '<body><script>console.log("a")</script></body></html>';
    const blocks: Block[] = [
      styleBlock({ index: 0, originalContent: 'a{color:red;}', content: 'a{color:pink;}' }),
      styleBlock({ index: 1, originalContent: 'b{color:green;}', content: 'b{color:lime;}' }),
      scriptBlock({ originalContent: 'console.log("a")', content: 'console.log("b")' }),
    ];
    const result = composeDocument(html, blocks);
    expect(result).toContain('a{color:pink;}');
    expect(result).toContain('b{color:lime;}');
    expect(result).toContain('console.log("b")');
    expect(result).not.toContain('a{color:red;}');
    expect(result).not.toContain('b{color:green;}');
    expect(result).not.toContain('console.log("a")');
  });

  // TH-133
  test('TH_133_original_html_preserved_outside_block_content', () => {
    const html = '<html><head><title>My Page</title><style>a{color:red;}</style></head><body><h1>Hello</h1></body></html>';
    const block = styleBlock({ originalContent: 'a{color:red;}', content: 'a{color:blue;}' });
    const result = composeDocument(html, [block]);
    expect(result).toContain('<title>My Page</title>');
    expect(result).toContain('<h1>Hello</h1>');
  });

  // TH-134 - script block substitution works same as style
  test('TH_134_script_block_substitution', () => {
    const html = '<html><body><script>var x = 1;</script></body></html>';
    const block = scriptBlock({ originalContent: 'var x = 1;', content: 'var x = 2;' });
    const result = composeDocument(html, [block]);
    expect(result).toContain('var x = 2;');
    expect(result).not.toContain('var x = 1;');
  });

  // TH-135 - appended script (not found) uses <script> tag
  test('TH_135_missing_script_block_appended_as_script_tag', () => {
    const html = '<html><body></body></html>';
    const block = scriptBlock({ originalContent: 'notpresent();', content: 'notpresent();' });
    const result = composeDocument(html, [block]);
    expect(result).toContain('<script>notpresent();</script>');
  });

  // TH-136 - no closing body tag appends at end
  test('TH_136_missing_block_with_no_body_close_appends_at_end', () => {
    const html = '<html><head></head></html>';
    const block = styleBlock({ originalContent: '.x{}', content: '.x{}' });
    const result = composeDocument(html, [block]);
    expect(result.endsWith('<style>.x{}</style>')).toBe(true);
  });

  // TH-138 - single-pass replace only touches first occurrence
  test('TH_138_replace_is_single_pass_not_global', () => {
    const html = '<style>dup{}</style><style>dup{}</style>';
    const block = styleBlock({ originalContent: 'dup{}', content: 'changed{}' });
    const result = composeDocument(html, [block]);
    expect(result).toBe('<style>changed{}</style><style>dup{}</style>');
  });

  // TH-139 - style agent script present when flag set (scroll restore infra)
  test('TH_139_inject_style_agent_flag_adds_agent_script', () => {
    const html = '<html><body></body></html>';
    const result = composeDocument(html, [], { injectStyleAgent: true });
    expect(result).toContain(STYLE_AGENT_SCRIPT);
  });

  test('TH_139_style_agent_script_saves_and_restores_scroll_position', () => {
    expect(STYLE_AGENT_SCRIPT).toMatch(/scrollX/);
    expect(STYLE_AGENT_SCRIPT).toMatch(/scrollY/);
    expect(STYLE_AGENT_SCRIPT).toMatch(/window\.scrollTo\(\s*scrollX\s*,\s*scrollY\s*\)/);
  });

  // TH-140
  test('TH_140_empty_blocks_array_returns_html_unchanged', () => {
    const html = '<html><body><p>unchanged</p></body></html>';
    const result = composeDocument(html, []);
    expect(result).toBe(html);
  });

  test('TH_140_empty_blocks_with_inject_flag_still_injects_agent', () => {
    const html = '<html><body></body></html>';
    const result = composeDocument(html, [], { injectStyleAgent: false });
    expect(result).toBe(html);
  });
});
