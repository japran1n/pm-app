import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Phase 3 of the standalone Sitemap tool: shown for an unknown or
// revoked share token. Deliberately does not distinguish "never
// existed" from "revoked" -- both are the same answer to a public
// visitor.
export default function SharedSitemapNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          This sitemap link is no longer active.
        </p>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
