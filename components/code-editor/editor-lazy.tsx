// F051 (TH-176..TH-180) — Lazy-load boundary for the Monaco editor chunk.
//
// Monaco (~2MB) must not be paid for by any route other than the
// code-editor route. `next/dynamic` with `ssr: false` keeps EditorPane out
// of the server render (Monaco needs `window`/`document` and doesn't run
// server-side) and, more importantly, out of any shared/eagerly-loaded
// bundle: the import only resolves when this component actually mounts.
// Wrapping in `React.Suspense` gives the async chunk a fallback while it
// loads instead of a blank pane.
"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import type { EditorPaneProps } from "@/components/code-editor/editor-pane";

const EditorPane = dynamic(
  () => import("@/components/code-editor/editor-pane").then((mod) => mod.EditorPane),
  { ssr: false },
);

function EditorSkeleton() {
  return <div className="h-full w-full animate-pulse bg-muted" data-testid="editor-skeleton" />;
}

/**
 * Lazy boundary around `EditorPane`. Import this component (not
 * `EditorPane` directly) from anywhere that needs to render the editor, so
 * the Monaco chunk is only fetched when this boundary mounts.
 */
export default function EditorLazy(props: EditorPaneProps) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditorPane {...props} />
    </Suspense>
  );
}
