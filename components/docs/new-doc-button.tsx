"use client";

// Small client boundary for the "New document" empty-state CTA (W3) — the
// page itself stays a Server Component; this is just the button that calls
// the `createDoc` action and navigates to the new doc's editor.

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createDoc } from "@/lib/actions/docs";

export function NewDocButton({
  workspaceId,
  workspaceSlug,
  projectId,
}: {
  workspaceId: string;
  workspaceSlug: string;
  projectId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await createDoc(workspaceId, null, projectId ?? null);
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          const href = projectId
            ? `/w/${workspaceSlug}/projects/${projectId}/docs/${result.id}`
            : `/w/${workspaceSlug}/docs/${result.id}`;
          router.refresh();
          router.push(href);
        });
      }}
    >
      New document
    </Button>
  );
}
