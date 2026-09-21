import { Skeleton } from "@/components/ui/skeleton";

// F100: loading state for the Webflow Code Editor route shell.
export default function CodeEditorLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
