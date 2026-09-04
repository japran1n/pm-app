import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the record settings page's header + panel
// shape. Mirrors the sibling settings/deliverables/loading.tsx pattern.
export default function ProjectSettingsRecordLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
