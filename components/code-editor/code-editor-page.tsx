"use client";

// F100 (TH-006): placeholder shell for the Webflow Code Editor tool. The
// real three-pane editor/preview UI is built by F101+ (F050 milestone) --
// this component exists only so the route at
// /w/[workspaceSlug]/tools/code-editor renders without error today.
export function CodeEditorPage() {
  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="text-base font-medium text-foreground">Webflow Code Editor</h1>
      <p className="text-sm text-muted-foreground">
        The code editor is coming soon.
      </p>
    </div>
  );
}
