import { Skeleton } from "@/components/ui/skeleton";

// F05 (SP-031): loading state matching the staging page's header + preview
// frame shape, same convention as the sibling hours/loading.tsx.
export default function ProjectStagingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Skeleton className="h-10 w-full rounded-none" />
        <Skeleton className="h-[480px] w-full rounded-none" />
      </div>
    </div>
  );
}
