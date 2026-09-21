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
      disabled={isPending || disabled}
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
            {/* A disabled button swallows pointer events, so the span is the trigger. */}
            <TooltipTrigger
              render={
                <span
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus for tooltip over a disabled button
                  tabIndex={0}
                  data-testid="generate-document-disabled-trigger"
                />
              }
            >
              {button}
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
