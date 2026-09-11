"use client";

// F071 (AS-139): "Generate Document" button on the team brief screen.
//
// Client Component boundary kept minimal -- just the button, its pending
// state, and the redirect on success -- mirroring the rest of this
// codebase's "server fetch, thin client control" split for one-off
// actions (e.g. components/brief/delete-question-button.tsx).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { generateBriefDocument } from "@/lib/actions/brief";

export function GenerateDocumentButton({
  workspaceSlug,
  projectId,
  briefId,
}: {
  workspaceSlug: string;
  projectId: string;
  briefId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await generateBriefDocument(projectId, briefId);
      if (!result.success || !result.documentId) {
        setError(result.error ?? "Couldn't generate the brief document.");
        return;
      }
      router.push(`/w/${workspaceSlug}/projects/${projectId}/docs/${result.documentId}`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={isPending} size="sm" variant="primary">
        {isPending ? "Generating…" : "Generate Document"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
