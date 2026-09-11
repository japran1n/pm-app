"use client";

// F074 (AS-145/AS-146): "Request approval" button on the team brief
// screen, offered once a brief document exists (generateBriefDocument,
// F071) -- the document is what gets recorded as the approval request's
// subject (AS-146), so there is nothing to request approval of before
// one has been generated. Mirrors components/brief/generate-document-
// button.tsx's minimal client-boundary shape.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { requestBriefApproval } from "@/lib/actions/brief";

export function RequestApprovalButton({
  projectId,
  documentId,
}: {
  projectId: string;
  documentId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await requestBriefApproval(projectId, documentId);
      if (!result.success) {
        setError(result.error ?? "Couldn't request approval.");
        return;
      }
      setRequested(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={isPending || requested} size="sm" variant="secondary">
        {requested ? "Approval requested" : isPending ? "Requesting…" : "Request approval"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
