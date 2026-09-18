import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// P2-3: portal-segment 404 -- the nearest not-found.tsx to
// `p/[projectId]/layout.tsx`'s `notFound()` call (a project id that
// doesn't exist, isn't shared with this client, or has `portal_enabled =
// false` all collapse to this same page, same "don't confirm which case
// it was" reasoning `[workspaceSlug]/layout.tsx`'s own comment gives for
// the workspace-level notFound() above this one). Deliberately does not
// reuse the app-shell chrome (no sidebar exists at this route depth --
// only `p/[projectId]/layout.tsx` renders one, and that layout is
// precisely what failed to resolve a project here), so this stays a
// plain, minimal page rather than risk exposing any internal navigation.
export default function PortalWorkspaceNotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-base font-medium">Project not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This project doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <Link href="/portal" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Go back to portal home
        </Link>
      </div>
    </div>
  );
}
