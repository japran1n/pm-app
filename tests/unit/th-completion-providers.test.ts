import { describe, expect, it, vi } from "vitest";
import { registerCssCompletionProvider } from "@/lib/code-editor/css-completion-provider";
import { registerJsCompletionProvider } from "@/lib/code-editor/js-completion-provider";
import type * as Monaco from "monaco-editor";

// Our providers only ever call `provideCompletionItems` synchronously with
// (model, position) and read back `{ suggestions }` -- narrower than
// Monaco's real 4-arg, thenable-returning signature, which is why this
// fake declares its own minimal provider/result shape instead of
// `Monaco.languages.CompletionItemProvider` (typing against the real
// interface would fight the test's simplified synchronous call sites for
// no type-safety benefit, since the fake never implements the rest of
// that interface either).
interface FakeCompletionItem {
  label: string;
  kind: number;
  insertText: string;
}

interface FakeCompletionProvider {
  provideCompletionItems(
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
  ): { suggestions: FakeCompletionItem[] };
}

// A minimal fake of the `monaco` namespace surface used by our providers.
// We avoid importing the real `monaco-editor` package in tests because it
// pulls in browser-only APIs (workers, DOM) that don't run under vitest's
// default node/jsdom test environment. The fake mirrors exactly the shape
// our providers call: monaco.languages.registerCompletionItemProvider and
// monaco.languages.CompletionItemKind.
function createFakeMonaco() {
  const registered: Record<
    string,
    { languageId: string; provider: FakeCompletionProvider; disposed: boolean }
  > = {};

  const monaco = {
    languages: {
      CompletionItemKind: {
        Class: 5,
        Variable: 6,
        Text: 18,
        Property: 9,
      },
      registerCompletionItemProvider: vi.fn(
        (languageId: string, provider: FakeCompletionProvider) => {
          const disposable = {
            languageId,
            provider,
            disposed: false,
            dispose() {
              this.disposed = true;
            },
          };
          registered[languageId] = disposable;
          return disposable;
        },
      ),
    },
  };

  return { monaco: monaco as unknown as typeof Monaco, registered };
}

function fakeModel(lineText = "") {
  return {
    getWordUntilPosition: () => ({
      startColumn: 1,
      endColumn: lineText.length + 1,
      word: lineText,
    }),
  } as unknown as Monaco.editor.ITextModel;
}

const fakePosition = { lineNumber: 1, column: 1 } as Monaco.Position;

describe("CSS completion provider", () => {
  it("TH-141: registers a completion provider for the 'css' language", () => {
    const { monaco, registered } = createFakeMonaco();
    registerCssCompletionProvider(monaco, {
      classes: [],
      cssVars: [],
      dataAttrs: [],
    });

    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      "css",
      expect.any(Object),
    );
    expect(registered.css).toBeDefined();
  });

  it("TH-142: class names appear in CSS completions as .selector items", () => {
    const { monaco, registered } = createFakeMonaco();
    registerCssCompletionProvider(monaco, {
      classes: ["foo", "bar"],
      cssVars: [],
      dataAttrs: [],
    });

    const result = registered.css.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const labels = result.suggestions.map((s: FakeCompletionItem) => s.label);
    expect(labels).toContain(".foo");
    expect(labels).toContain(".bar");
    const fooItem = result.suggestions.find((s: FakeCompletionItem) => s.label === ".foo");
    expect(fooItem).toBeDefined();
    expect(fooItem!.insertText).toBe(".foo");
    expect(fooItem!.kind).toBe(monaco.languages.CompletionItemKind.Class);
  });

  it("TH-143: CSS custom properties appear as var() completions", () => {
    const { monaco, registered } = createFakeMonaco();
    registerCssCompletionProvider(monaco, {
      classes: [],
      cssVars: ["--primary", "--accent"],
      dataAttrs: [],
    });

    const result = registered.css.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const primary = result.suggestions.find((s: FakeCompletionItem) => s.label === "--primary");
    expect(primary).toBeDefined();
    expect(primary!.insertText).toBe("var(--primary)");
    expect(primary!.kind).toBe(monaco.languages.CompletionItemKind.Variable);
  });

  it("TH-146: dispose() removes the CSS provider registration", () => {
    const { monaco, registered } = createFakeMonaco();
    const disposable = registerCssCompletionProvider(monaco, {
      classes: ["foo"],
      cssVars: [],
      dataAttrs: [],
    });

    expect(registered.css.disposed).toBe(false);
    disposable.dispose();
    expect(registered.css.disposed).toBe(true);
  });

  it("TH-147: empty CSS corpus does not throw when registering", () => {
    const { monaco } = createFakeMonaco();
    expect(() =>
      registerCssCompletionProvider(monaco, {
        classes: [],
        cssVars: [],
        dataAttrs: [],
      }),
    ).not.toThrow();
  });

  it("TH-148: empty CSS corpus provider returns an empty suggestions array", () => {
    const { monaco, registered } = createFakeMonaco();
    registerCssCompletionProvider(monaco, {
      classes: [],
      cssVars: [],
      dataAttrs: [],
    });
    const result = registered.css.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    expect(result.suggestions).toEqual([]);
  });

  it("TH-149: CSS provider returns an IDisposable with a dispose function", () => {
    const { monaco } = createFakeMonaco();
    const disposable = registerCssCompletionProvider(monaco, {
      classes: [],
      cssVars: [],
      dataAttrs: [],
    });
    expect(typeof disposable.dispose).toBe("function");
  });
});

describe("JS completion provider", () => {
  it("TH-144: registers a completion provider for the 'javascript' language", () => {
    const { monaco, registered } = createFakeMonaco();
    registerJsCompletionProvider(monaco, { classes: [], dataAttrs: [] });

    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      "javascript",
      expect.any(Object),
    );
    expect(registered.javascript).toBeDefined();
  });

  it("TH-145: class names appear in JS completions as bare string literals", () => {
    const { monaco, registered } = createFakeMonaco();
    registerJsCompletionProvider(monaco, { classes: ["foo", "bar"], dataAttrs: [] });

    const result = registered.javascript.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const labels = result.suggestions.map((s: FakeCompletionItem) => s.label);
    expect(labels).toContain("foo");
    expect(labels).toContain("bar");
  });

  it("TH-150: class names appear in JS completions for querySelector-style usage", () => {
    const { monaco, registered } = createFakeMonaco();
    registerJsCompletionProvider(monaco, { classes: ["foo", "bar"], dataAttrs: [] });

    const result = registered.javascript.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const labels = result.suggestions.map((s: FakeCompletionItem) => s.label);
    expect(labels).toContain("foo");
    expect(labels).toContain("bar");
    const fooItem = result.suggestions.find((s: FakeCompletionItem) => s.label === "foo");
    expect(fooItem).toBeDefined();
    expect(fooItem!.insertText).toBe("foo");
  });

  it("TH-151: data-* attribute names appear in JS completions", () => {
    const { monaco, registered } = createFakeMonaco();
    registerJsCompletionProvider(monaco, { classes: [], dataAttrs: ["testid", "role"] });

    const result = registered.javascript.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const labels = result.suggestions.map((s: FakeCompletionItem) => s.label);
    expect(labels).toContain("data-testid");
    expect(labels).toContain("data-role");
  });

  it("TH-152: dispose() removes the JS provider registration", () => {
    const { monaco, registered } = createFakeMonaco();
    const disposable = registerJsCompletionProvider(monaco, {
      classes: ["foo"],
      dataAttrs: [],
    });

    expect(registered.javascript.disposed).toBe(false);
    disposable.dispose();
    expect(registered.javascript.disposed).toBe(true);
  });

  it("TH-153: empty JS corpus provider returns an empty suggestions array", () => {
    const { monaco, registered } = createFakeMonaco();
    registerJsCompletionProvider(monaco, { classes: [], dataAttrs: [] });
    const result = registered.javascript.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    expect(result.suggestions).toEqual([]);
  });

  it("TH-154: JS provider returns an IDisposable with a dispose function", () => {
    const { monaco } = createFakeMonaco();
    const disposable = registerJsCompletionProvider(monaco, {
      classes: [],
      dataAttrs: [],
    });
    expect(typeof disposable.dispose).toBe("function");
  });
});

describe("Provider isolation and cleanup", () => {
  it("TH-155: CSS and JS providers register independently under different language ids", () => {
    const { monaco, registered } = createFakeMonaco();
    registerCssCompletionProvider(monaco, { classes: ["a"], cssVars: [], dataAttrs: [] });
    registerJsCompletionProvider(monaco, { classes: ["a"], dataAttrs: [] });

    expect(registered.css).toBeDefined();
    expect(registered.javascript).toBeDefined();
    expect(registered.css.provider).not.toBe(registered.javascript.provider);
  });

  it("TH-156: disposing the CSS provider does not affect the JS provider", () => {
    const { monaco, registered } = createFakeMonaco();
    const cssDisposable = registerCssCompletionProvider(monaco, {
      classes: [],
      cssVars: [],
      dataAttrs: [],
    });
    registerJsCompletionProvider(monaco, { classes: [], dataAttrs: [] });

    cssDisposable.dispose();
    expect(registered.css.disposed).toBe(true);
    expect(registered.javascript.disposed).toBe(false);
  });

  it("TH-157: JS provider does not leak CSS-only cssVars into its suggestions", () => {
    const { monaco, registered } = createFakeMonaco();
    registerJsCompletionProvider(monaco, { classes: ["foo"], dataAttrs: [] });

    const result = registered.javascript.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const labels = result.suggestions.map((s: FakeCompletionItem) => s.label);
    expect(labels.some((l: string) => l.startsWith("--"))).toBe(false);
  });

  it("TH-158: CSS provider does not include data-* attributes as suggestions", () => {
    const { monaco, registered } = createFakeMonaco();
    registerCssCompletionProvider(monaco, {
      classes: [],
      cssVars: [],
      dataAttrs: ["testid"],
    });

    const result = registered.css.provider.provideCompletionItems(
      fakeModel(),
      fakePosition,
    );
    const labels = result.suggestions.map((s: FakeCompletionItem) => s.label);
    expect(labels.some((l: string) => l.includes("data-"))).toBe(false);
  });

  it("TH-159: registering twice produces two independent disposables, both disposable safely", () => {
    const { monaco, registered } = createFakeMonaco();
    const d1 = registerCssCompletionProvider(monaco, {
      classes: ["a"],
      cssVars: [],
      dataAttrs: [],
    });
    const d2 = registerCssCompletionProvider(monaco, {
      classes: ["b"],
      cssVars: [],
      dataAttrs: [],
    });

    expect(() => {
      d1.dispose();
      d2.dispose();
    }).not.toThrow();
  });
});
