import { Skeleton } from "@/components/ui/skeleton";

// Loading state shown by Next.js while the Server Component page below is
// fetching, matching the members settings page's existing convention
// (shadcn Skeleton).
export default function ProfileSettingsLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full max-w-sm" />
        <Skeleton className="h-16 w-full max-w-sm" />
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  );
}
