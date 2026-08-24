import { Skeleton } from "@/components/ui/skeleton";

// F255 (AS-495, AS-496): loading state matching the templates page's
// header + list-of-template-rows shape.
export default function TemplatesLoading() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-28" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
