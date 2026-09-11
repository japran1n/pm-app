"use client";

// F075 (AS-147): "Approve" button on the team brief screen. Team-side
// only (PM/owners write path via `briefs_all_team`, F046) -- approving
// sets brief.state to 'approved'. Same minimal client-boundary shape as
// components/brief/generate-document-button.tsx and
// components/brief/request-approval-button.tsx.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { approveBrief } from "@/lib/actions/brief";

export function ApproveBriefButton({ briefId }: { briefId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await approveBrief(briefId);
      if (!result.success) {
        setError(result.error ?? "Couldn't approve this brief.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={isPending} size="sm" variant="primary">
        {isPending ? "Approving…" : "Approve"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
