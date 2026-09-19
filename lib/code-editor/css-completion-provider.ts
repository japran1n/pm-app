import type * as Monaco from 'monaco-editor';

export interface CssCompletionCorpus {
  classes: string[];
  cssVars: string[];
  dataAttrs?: string[];
}

/**
 * Registers a CompletionItemProvider for the 'css' language that suggests
 * class selectors (from corpus.classes) and custom property completions
 * (from corpus.cssVars, e.g. `--primary` -> `var(--primary)`).
 *
 * Returns the Monaco IDisposable so the caller can dispose it on unmount /
 * corpus refresh (never leaves stale providers registered).
 */
export function registerCssCompletionProvider(
  monaco: typeof Monaco,
  corpus: CssCompletionCorpus,
): Monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('css', {
    triggerCharacters: ['.', '-', '('],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: Monaco.languages.CompletionItem[] = [];

      for (const cls of corpus.classes ?? []) {
        suggestions.push({
          label: `.${cls}`,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: `.${cls}`,
          range,
        });
      }

      for (const cssVar of corpus.cssVars ?? []) {
        suggestions.push({
          label: cssVar,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `var(${cssVar})`,
          range,
        });
      }

      return { suggestions };
    },
  });
}
