import { Skeleton } from "@/components/ui/skeleton";

// F002 (missions/20260903-portal): loading state matching the phases
// settings page's header + phase-list shape. Mirrors the sibling
// settings/columns/loading.tsx exactly.
export default function PhasesSettingsLoading() {
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
