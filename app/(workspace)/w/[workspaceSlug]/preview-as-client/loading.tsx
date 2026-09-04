import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the preview-as-client page's header +
// client-picker list shape.
export default function PreviewAsClientLoading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}
