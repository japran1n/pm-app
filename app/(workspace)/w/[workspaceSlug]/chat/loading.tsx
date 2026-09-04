import { Skeleton } from "@/components/ui/skeleton";

// F083: loading state matching the mobile chat index page's channel-nav
// list shape.
export default function ChatLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 md:hidden">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
