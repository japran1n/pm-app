import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the docs index page's header + doc-list
// shape.
export default function DocsLoading() {
  return (
    <div className="flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex flex-col gap-1">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
