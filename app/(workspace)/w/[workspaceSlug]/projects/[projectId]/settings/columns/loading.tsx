import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the board-columns settings
// page's header + column-list shape.
export default function ColumnsSettingsLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-36" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
