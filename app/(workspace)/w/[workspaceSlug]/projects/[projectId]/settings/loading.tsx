import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the project settings
// page's header + visibility section + members list section shape.
export default function ProjectSettingsLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
