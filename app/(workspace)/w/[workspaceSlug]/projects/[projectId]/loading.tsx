// F019 (AS-019): project detail route gets its own loading boundary shaped
// like a project page, instead of falling back to the workspace-level
// dashboard-shaped loading.tsx (app/(workspace)/w/[workspaceSlug]/loading.tsx).
// Mirrors the real layout's structure (layout.tsx in this same directory):
// breadcrumb, title, tab bar, content area — using the same
// `flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8` shell so there's no layout
// shift when the real content swaps in.
export default function ProjectDetailLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      {/* Breadcrumb skeleton — two items (workspace / project) */}
      <div className="flex items-center gap-2">
        <div className="bg-muted animate-pulse rounded h-4 w-24" />
        <div className="bg-muted animate-pulse rounded h-4 w-4" />
        <div className="bg-muted animate-pulse rounded h-4 w-32" />
      </div>

      <div className="flex flex-col gap-4">
        {/* Title skeleton */}
        <div className="bg-muted animate-pulse rounded h-7 w-64" />

        {/* Tab bar skeleton — Board / List */}
        <div className="flex items-center gap-2">
          <div className="bg-muted animate-pulse rounded h-8 w-20" />
          <div className="bg-muted animate-pulse rounded h-8 w-20" />
        </div>

        {/* Content area placeholder */}
        <div className="bg-muted animate-pulse rounded h-96 w-full" />
      </div>
    </div>
  );
}
