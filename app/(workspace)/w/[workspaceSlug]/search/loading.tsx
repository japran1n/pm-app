import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the search page's header
// + result-row list shape.
export default function SearchLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}
