import { Skeleton } from "@/components/ui/skeleton";

export default function PortalStagingLoading() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-[640px] w-full rounded-md" />
    </div>
  );
}
