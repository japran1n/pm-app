import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the list page's toolbar
// + table shape.
export default function ListLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="flex flex-col gap-px bg-border">
          <Skeleton className="h-12 w-full rounded-none" />
          <Skeleton className="h-12 w-full rounded-none" />
          <Skeleton className="h-12 w-full rounded-none" />
          <Skeleton className="h-12 w-full rounded-none" />
          <Skeleton className="h-12 w-full rounded-none" />
        </div>
      </div>
    </div>
  );
}
