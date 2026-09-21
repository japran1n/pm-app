import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching a single doc's breadcrumb + editor shape.
export default function DocLoading() {
  return (
    <div className="flex flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <Skeleton className="h-3 w-56" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
