import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Audit NX-004: styled 404 inside the root layout, replacing Next's
// default unstyled page for notFound() calls and unmatched URLs.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-base font-medium">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page doesn&apos;t exist, or you don&apos;t have access to it.
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
