// F056 (TH-184..TH-188) — Prettier v3 format-on-save.
//
// Prettier 3's standalone browser build is fully async and loads no parser
// plugins implicitly. Moden's code (Prettier 2.8.8, synchronous, no estree
// plugin) cannot be ported verbatim -- under v3 the babel parser throws
// "Couldn't find plugin for AST format estree" without the estree plugin
// loaded alongside it. See tech-decisions.md.
//
// `prettier/standalone` and its plugins are imported dynamically, inside
// `formatCode`, so the ~1MB+ of parser code is only fetched the first time
// a save actually triggers a format (TH-188) -- not paid for by every
// editor mount.
export type FormatLanguage = "css" | "javascript";

/**
 * Formats `code` with Prettier for the given language. Returns the
 * formatted string on success. On any formatting error (syntax error,
 * plugin failure, etc.) returns the original `code` unchanged -- a failed
 * format must never throw and must never lose the user's content.
 */
export async function formatCode(code: string, language: FormatLanguage): Promise<string> {
  try {
    const prettier = await import("prettier/standalone");

    if (language === "css") {
      // Prettier's browser build ships the CSS parser under the
      // `postcss` plugin module (there is no separate `plugins/css`
      // export) -- it still registers the `css` parser name used below.
      const cssPlugin = await import("prettier/plugins/postcss");
      const formatted = await prettier.format(code, {
        parser: "css",
        plugins: [cssPlugin.default ?? cssPlugin],
      });
      return formatted;
    }

    const [babelPlugin, estreePlugin] = await Promise.all([
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    const formatted = await prettier.format(code, {
      parser: "babel",
      plugins: [babelPlugin.default ?? babelPlugin, estreePlugin.default ?? estreePlugin],
    });
    return formatted;
  } catch {
    return code;
  }
}
