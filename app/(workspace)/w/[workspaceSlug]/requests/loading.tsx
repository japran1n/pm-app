import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the client requests page's header +
// inbox-list shape.
export default function RequestsLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
