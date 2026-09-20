import { Skeleton } from "@/components/ui/skeleton";

// Phase 3 of the standalone Sitemap tool: skeleton for the public share
// route while resolveSitemapShareToken resolves.
export default function SharedSitemapLoading() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <Skeleton className="h-full w-full rounded-md" />
      </div>
    </div>
  );
}
