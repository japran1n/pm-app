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
  /** Whether the current file has unsaved edits (TH-182). Shown as a `•`
   * prefix in the pane's title bar. Owned by the parent (see
   * `lib/code-editor/use-dirty-state.ts`) since dirtiness is tracked per
   * block index across the whole multi-file editor, not just this pane. */
  isDirty?: boolean;
  /** Called after Ctrl+S/Cmd+S finishes formatting and applying the saved
   * content (TH-181, TH-183) -- the parent uses this to call
   * `markClean(index)`. */
  onSave?: () => void;
}

function languageForBlock(file: Block): "css" | "javascript" {
  return file.type === "style" ? "css" : "javascript";
}

/**
 * Editor pane for a single style/script block. Renders Monaco bound to the
 * block's content, reporting edits via `onChange`. Language mode follows
 * the block type; theme follows the app's light/dark ThemeProvider state.
 */
export function EditorPane({
  file,
  onChange,
  corpus: _corpus,
  isDirty = false,
  onSave,
}: EditorPaneProps) {
  const { resolvedTheme } = useTheme();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  const language = useMemo(() => languageForBlock(file), [file]);
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  // The Ctrl+S command is registered once, in `onMount`, but must always
  // act on the *current* language/onChange/onSave -- keep them in refs so
  // the command closure never goes stale across re-renders (e.g. switching
  // the selected block without remounting Monaco).
  const languageRef = useRef(language);
  languageRef.current = language;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

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

  // TH-181/TH-183 — Ctrl+S/Cmd+S formats the current content through
  // Prettier (F056), applies the formatted result back into the editor and
  // reports it via `onChange`, then calls `onSave` so the parent can clear
  // the dirty flag for this block.
  const handleMount: OnMount = useCallback((editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      const current = editor.getValue();
      const formatted = await formatCode(current, languageRef.current);
      if (formatted !== current) {
        editor.setValue(formatted);
      }
      onChangeRef.current(formatted);
      onSaveRef.current?.();
    });
  }, []);

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
      <div className="flex items-center justify-between gap-2 p-2">
        <span data-testid="editor-dirty-indicator" className="text-xs">
          {isDirty ? "•" : ""}
        </span>
        <div className="flex items-center gap-2">
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
      </div>
      <Editor
        key={retryKey}
        language={language}
        theme={monacoTheme}
        value={file.content}
        onChange={handleChange}
        onMount={handleMount}
        onValidate={() => {}}
        loading={<div>Loading editor…</div>}
      />
    </div>
  );
}
