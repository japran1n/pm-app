import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the task-types settings page's header +
// sub-nav + list shape. Mirrors the sibling settings/loading.tsx pattern.
export default function SettingsTaskTypesLoading() {
  return (
    <div className="flex flex-col gap-8 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-8 w-full max-w-md" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
