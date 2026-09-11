"use client";

// F077 (AS-151): "Withdraw approval" button on the team brief screen.
// Shown only when brief.state === 'approved' (page.tsx's caller gate) --
// withdrawal sets brief.state back to 'submitted', which unlocks answers
// again per F076's brief.state !== 'approved' checks (RLS +
// saveBriefAnswer's own guard, lib/actions/brief.ts). Same minimal
// client-boundary shape as components/brief/approve-brief-button.tsx.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { withdrawBriefApproval } from "@/lib/actions/brief";

export function WithdrawApprovalButton({ briefId }: { briefId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await withdrawBriefApproval(briefId);
      if (!result.success) {
        setError(result.error ?? "Couldn't withdraw this approval.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={isPending} size="sm" variant="outline">
        {isPending ? "Withdrawing…" : "Withdraw approval"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
