"use client";

// NX-006: the doc editor pages are Server Components, and this Next.js
// version rejects `ssr: false` inside a Server Component's `next/dynamic`
// call (see the doc comment in
// app/(workspace)/w/[workspaceSlug]/docs/[docId]/page.tsx) — which is why
// MarkdownEditor used to be statically imported there, eagerly bundling
// Tiptap (StarterKit, task-list/task-item extensions, tiptap-markdown) into
// the docs route's shared client bundle. This thin client wrapper is the
// same pattern as components/dashboard/dashboard-content-lazy.tsx: the
// `ssr: false` dynamic import is legal here, so the Tiptap chunk only
// downloads when a doc editor page actually renders on the client.
//
// MarkdownEditor is client-only interactive input by construction
// (`useEditor` with `immediatelyRender: false` — the editing surface never
// produced meaningful server-rendered content; it only appears after
// hydration), so `ssr: false` loses nothing users could previously see
// pre-hydration. The loading placeholder mirrors the editor's real shell
// (title row + content area, same `flex flex-col gap-4` wrapper) so the
// page layout doesn't jump while the chunk loads. The doc's title itself
// is already visible in the breadcrumb both pages render above this
// component. No editor behavior, props, or focus semantics change — this
// wrapper forwards every prop untouched.

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MarkdownEditor } from "./markdown-editor";

const MarkdownEditorDynamic = dynamic(
  () => import("./markdown-editor").then((mod) => mod.MarkdownEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-9 w-64 max-w-full animate-pulse rounded-md bg-muted/50" />
        </div>
        <div className="min-h-64 animate-pulse rounded-md bg-muted/30" />
      </div>
    ),
  },
);

export function MarkdownEditorLazy(
  props: ComponentProps<typeof MarkdownEditor>,
) {
  return <MarkdownEditorDynamic {...props} />;
}
