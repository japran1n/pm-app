import type * as Monaco from 'monaco-editor';

export interface JsCompletionCorpus {
  classes: string[];
  dataAttrs: string[];
}

/**
 * Registers a CompletionItemProvider for the 'javascript' language that
 * suggests class names as string literals (for querySelector/classList
 * style usage) and data-* attribute names (e.g. `data-foo`).
 *
 * Returns the Monaco IDisposable so the caller can dispose it on unmount /
 * corpus refresh (never leaves stale providers registered).
 */
export function registerJsCompletionProvider(
  monaco: typeof Monaco,
  corpus: JsCompletionCorpus,
): Monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['"', "'", '.', '-'],
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
          label: cls,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: cls,
          range,
        });
      }

      for (const attr of corpus.dataAttrs ?? []) {
        const name = `data-${attr}`;
        suggestions.push({
          label: name,
          kind: monaco.languages.CompletionItemKind.Property,
          insertText: name,
          range,
        });
      }

      return { suggestions };
    },
  });
}
