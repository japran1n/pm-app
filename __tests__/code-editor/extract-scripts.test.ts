import { describe, expect, test } from 'vitest';
import { extractScriptBlocks } from '@/lib/code-editor/extract';

describe('extractScriptBlocks', () => {
  test('TH-101: extracts inline <script> blocks (no src)', () => {
    const html = `<html><body><script>console.log('hi');</script></body></html>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('script');
    expect(blocks[0].content).toBe(`console.log('hi');`);
  });

  test('TH-102: external <script src="..."> blocks are excluded', () => {
    const html = `<html><body><script src="/app.js"></script><script>var a=1;</script></body></html>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('var a=1;');
  });

  test('excludes nonce-bearing scripts injected by proxy', () => {
    const html = `<html><body><script nonce="abc123">window.__proxy=1;</script><script>var b=2;</script></body></html>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('var b=2;');
  });

  test('multiple inline scripts extracted in document order', () => {
    const html = `<script>var one=1;</script><div></div><script>var two=2;</script><script>var three=3;</script>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks.map((b) => b.content)).toEqual(['var one=1;', 'var two=2;', 'var three=3;']);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  test('TH-104: empty document returns []', () => {
    expect(extractScriptBlocks('')).toEqual([]);
    expect(extractScriptBlocks('<html><body></body></html>')).toEqual([]);
  });

  test('TH-105: malformed HTML does not throw', () => {
    expect(() => extractScriptBlocks('<script>unclosed console.log(1)')).not.toThrow();
    expect(() => extractScriptBlocks(null as unknown as string)).not.toThrow();
    expect(() => extractScriptBlocks(undefined as unknown as string)).not.toThrow();
    expect(extractScriptBlocks('<script>unclosed console.log(1)')).toEqual([]);
  });

  test('TH-106: content matches exactly, including whitespace', () => {
    const html = `<script>\n  const x = 1;\n  console.log(x);\n</script>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks[0].content).toBe('\n  const x = 1;\n  console.log(x);\n');
    expect(blocks[0].originalContent).toBe(blocks[0].content);
  });
});
