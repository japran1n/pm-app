import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceHomeLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <Skeleton className="h-7 w-48" />
      {/* KPI tiles row — 4 cards matching the actual dashboard grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      {/* Charts row — 2 cards matching the actual bar + pie chart layout */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}
