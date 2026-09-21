import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the workspace settings
// page's header + "General" form section + danger-zone section shape.
export default function WorkspaceSettingsLoading() {
  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-9 w-full max-w-sm" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-40" />
      </div>
    </div>
  );
}
