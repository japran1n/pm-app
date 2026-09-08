import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getDocById } from "@/lib/queries/docs";
import { MarkdownEditor } from "@/components/docs/markdown-editor";

// W4 (docs/docs-system-plan.md): the workspace-scoped doc editor page.
//
// Rendered inside `docs/layout.tsx` (workspace guard + sidebar already
// applied one level up), so this page only has to resolve the workspace and
// the specific doc.
//
// `MarkdownEditor` is a `"use client"` component with `immediatelyRender:
// false` set on its `useEditor` call (avoids the SSR/hydration mismatch
// Tiptap would otherwise hit) — it is imported directly here rather than via
// `next/dynamic({ ssr: false })`, since this Next.js version rejects
// `ssr: false` inside a Server Component's `next/dynamic` call ("`ssr: false`
// is not allowed with `next/dynamic` in Server Components. Please move it
// into a Client Component.", confirmed via `npm run build`). Deviates from
// the spec's literal wording ("dynamic import sa `{ ssr: false }`") for this
// reason — see handoff.

export default async function DocEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; docId: string }>;
}) {
  const { workspaceSlug, docId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    notFound();
  }

  const doc = await getDocById(docId);

  if (!doc || doc.workspaceId !== workspace.id) {
    notFound();
  }

  // A doc that actually belongs to a project must be edited through its
  // project-scoped URL (W5) — keeps a single canonical URL per doc rather
  // than letting the same doc render at two different paths.
  if (doc.projectId !== null) {
    redirect(`/w/${workspaceSlug}/projects/${doc.projectId}/docs/${doc.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-micro text-muted-foreground">
        {workspace.name} / Docs / {doc.title}
      </p>
      <MarkdownEditor
        docId={doc.id}
        initialTitle={doc.title}
        initialContent={doc.content}
      />
    </div>
  );
}
