import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the time report page's
// header + date-range controls + per-member table shape.
export default function TimeLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="flex flex-col gap-px bg-border">
          <Skeleton className="h-10 w-full rounded-none" />
          <Skeleton className="h-10 w-full rounded-none" />
          <Skeleton className="h-10 w-full rounded-none" />
        </div>
      </div>
    </div>
  );
}
