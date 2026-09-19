// F050 (TH-170..TH-173) — Editor component: mount, language switch, theme
// binding.
//
// A thin React Client Component wrapping `@monaco-editor/react`'s <Editor>.
// Points the loader at the locally-installed `monaco-editor` package via
// `configureMonaco()` (F002, TH-175) before render, so the editor never
// reaches a CDN. Language is derived from the selected block's type
// (css/javascript). Theme is read from the app's existing `next-themes`
// `ThemeProvider` (round 1 Q17(a)) — there is no second theme control here,
// and switching the app theme updates the editor without a reload.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { configureMonaco } from "@/lib/monaco-loader";
import type { Block } from "@/lib/code-editor/compose";
import type { Corpus } from "@/lib/code-editor/corpus";
import { copyToClipboard, wrapForCopy } from "@/lib/code-editor/clipboard";
import { formatCode } from "@/lib/code-editor/format";

// Configure the local Monaco loader once, at module load time, so it always
// runs before the first <Editor /> mounts regardless of how many
// EditorPane instances render concurrently (last-write-wins, safe to call
// more than once -- see lib/monaco-loader.ts).
configureMonaco();

export interface EditorPaneProps {
  file: Block;
  onChange: (content: string) => void;
  corpus?: Corpus;
}

function languageForBlock(file: Block): "css" | "javascript" {
  return file.type === "style" ? "css" : "javascript";
}

/**
 * Editor pane for a single style/script block. Renders Monaco bound to the
 * block's content, reporting edits via `onChange`. Language mode follows
 * the block type; theme follows the app's light/dark ThemeProvider state.
 */
export function EditorPane({ file, onChange, corpus: _corpus }: EditorPaneProps) {
  const { resolvedTheme } = useTheme();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  const language = useMemo(() => languageForBlock(file), [file]);
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  // Guard against a failed Monaco load (e.g. the locally-configured runtime
  // fails to initialize) so the user sees a retry option instead of a
  // silently-blank pane.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    const promise = loader.init();
    promise
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
      promise.cancel?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      onChange(value ?? "");
    },
    [onChange],
  );

  const handleRetry = useCallback(() => {
    setLoadError(null);
    setRetryKey((k) => k + 1);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(wrapForCopy(file, file.content));
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  }, [file]);

  if (loadError) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-2 p-4 text-sm">
        <p>Editor failed to load: {loadError}</p>
        <button type="button" onClick={handleRetry}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-2 p-2">
        <button type="button" onClick={handleCopy}>
          Copy
        </button>
        {copyStatus === "success" && (
          <span role="status" className="text-xs">
            Copied
          </span>
        )}
        {copyStatus === "error" && (
          <span role="alert" className="text-xs">
            Copy failed
          </span>
        )}
      </div>
      <Editor
        key={retryKey}
        language={language}
        theme={monacoTheme}
        value={file.content}
        onChange={handleChange}
        onValidate={() => {}}
        loading={<div>Loading editor…</div>}
      />
    </div>
  );
}
