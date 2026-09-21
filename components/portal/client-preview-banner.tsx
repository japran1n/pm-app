"use client";

// F024 (missions/20260903-portal, AS-052): the persistent, NOT dismissable
// banner rendered above every portal page while an owner/admin is
// previewing as a client (spec section 3: "A previewer who forgets they
// are in preview and reports 'the client can see internal tasks' costs a
// day"). There is deliberately no close/hide affordance here -- only
// "Exit preview", which actually ends the preview (clears the scoped
// cookies) rather than just hiding this banner while the session stays
// active underneath.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";

import { exitClientPreview } from "@/lib/actions/portal-preview";
import { Button } from "@/components/ui/button";

export function ClientPreviewBanner({
  workspaceSlug,
  clientLabel,
}: {
  workspaceSlug: string;
  clientLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleExit() {
    startTransition(async () => {
      const result = await exitClientPreview(workspaceSlug);
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      data-testid="client-preview-banner"
      // Preview-scroll fix: this banner is now a plain flex item in the
      // outer portal layout's column flex box (not a floating child of a
      // scrolling container), so it no longer needs `sticky` to stay
      // visible -- `shrink-0` keeps it from being compressed and lets the
      // sibling shell claim the rest of the viewport height.
      className="z-50 flex shrink-0 items-center justify-between gap-4 bg-status-blocked px-4 py-2 text-sm font-medium text-white"
    >
      <span className="flex items-center gap-2">
        <Eye className="size-4" aria-hidden="true" />
        Previewing the portal as {clientLabel}. This is exactly what they
        see -- nothing here is hidden from them.
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
        onClick={handleExit}
        disabled={isPending}
      >
        {isPending && <Loader2 className="size-4 animate-spin" />}
        Exit preview
      </Button>
    </div>
  );
}
