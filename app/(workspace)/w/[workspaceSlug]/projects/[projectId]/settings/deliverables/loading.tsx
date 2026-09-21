import { Skeleton } from "@/components/ui/skeleton";

// F013 (missions/20260903-portal): loading state matching the
// deliverables settings page's header + panel shape. Mirrors the sibling
// settings/phases/loading.tsx exactly.
export default function DeliverablesSettingsLoading() {
  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
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
