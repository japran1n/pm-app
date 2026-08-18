// F073: route-level loading state for the workspace home dashboard
// (app/(workspace)/w/[workspaceSlug]/page.tsx). Next.js renders this
// automatically while the page's Server Component (and its data fetches:
// workspace lookup + the two RPC calls) is still resolving, satisfying the
// clarified spec's "loading (shadcn Skeleton)" state without deferring the
// page's own primary content behind a client-side Suspense boundary
// (AS-155 stays intact: once the Server Component resolves, its output —
// including the charts' data — is part of the initial HTML, this file is
// only shown for the request that's still in flight).
import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceHomeLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Skeleton className="h-7 w-64" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}
