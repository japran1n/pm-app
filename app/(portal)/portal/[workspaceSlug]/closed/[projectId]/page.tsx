import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// P2-36: when a portal-enabled project is archived (`deleted_at IS NOT
// NULL`), bookmarked URLs for that project redirect here instead of
// throwing a 404. The page lives outside `p/[projectId]/layout.tsx` so
// that layout's own project-resolution guard does not fire again and
// create an infinite redirect cycle. No project-specific data is
// surfaced here — we deliberately do not confirm whether the project
// existed or who had access to it, matching the same "collapse cases"
// reasoning the workspace 404 (`not-found.tsx`) uses.
export default async function PortalProjectClosedPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="font-mono text-sm text-muted-foreground">Closed</p>
        <h1 className="text-base font-medium">This project has been closed</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The project is no longer active. Please contact the team if you have
          any questions.
        </p>
        <Link
          href={`/portal/${workspaceSlug}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to portal
        </Link>
      </div>
    </div>
  );
}
