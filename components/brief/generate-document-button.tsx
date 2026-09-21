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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { generateBriefDocument } from "@/lib/actions/brief";

export function GenerateDocumentButton({
  workspaceSlug,
  projectId,
  briefId,
  disabled = false,
  disabledReason = "Answer all required questions first",
}: {
  workspaceSlug: string;
  projectId: string;
  briefId: string;
  /** BR-024: true while required questions are unanswered. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    // BR-024: the button is aria-disabled (not natively disabled) so pointer
    // events reach the tooltip trigger; the action must still be impossible.
    if (disabled || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await generateBriefDocument(projectId, briefId);
      if (!result.success || !result.documentId) {
        setError(result.error ?? "Couldn't generate the brief document.");
        return;
      }
      router.push(
        `/w/${workspaceSlug}/projects/${projectId}/docs/${result.documentId}`,
      );
    });
  }

  const button = (
    <Button
      onClick={handleClick}
      disabled={isPending}
      size="sm"
      variant="primary"
    >
      {isPending ? "Generating…" : "Generate Document"}
    </Button>
  );

  return (
    <div className="flex flex-col items-start gap-1">
      {disabled ? (
        <TooltipProvider>
          <Tooltip>
            {/* aria-disabled keeps the button hoverable so the tooltip opens on mouse hover as well as focus. */}
            <TooltipTrigger
              render={
                <Button
                  onClick={handleClick}
                  size="sm"
                  variant="primary"
                  aria-disabled="true"
                  aria-label={`Generate Document (unavailable): ${disabledReason}`}
                  data-testid="generate-document-disabled-trigger"
                  className="cursor-not-allowed opacity-50 hover:bg-primary"
                />
              }
            >
              Generate Document
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
