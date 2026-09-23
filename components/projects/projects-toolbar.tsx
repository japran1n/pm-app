"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { NewProjectDialog } from "@/components/new-project-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";

// F012 (PL-042): a view value that isn't a recognised toggle value falls
// back to "grid" — matches the server page's own invalid-value fallback
// (app/(workspace)/w/[workspaceSlug]/projects/page.tsx).
function normalizeView(raw: string | null): "grid" | "list" {
  return raw === "list" ? "list" : "grid";
}

// F010 (PL-040): toolbar row for the Projects page — search input (left,
// grows to fill available space), view toggle (middle) and New Project
// (right). The view toggle sets `?view=grid|list` (F012, PL-042) — a
// Client Component since it needs router/searchParams access. The search
// input is a real, controlled input as of F011 (PL-041) — wired up by
// `ProjectsToolbarWithSearch`
// (components/projects/projects-search-context.tsx), which passes
// `searchValue`/`onSearchChange`; when neither is given (e.g. the
// archived view, or any other caller with nothing to search) it renders
// as a disabled placeholder, same as before F011.
//
// Layout: row (`flex-row`) with the search input taking the remaining
// space (`flex-1`) once there's room; below the `sm` breakpoint the row
// stacks (`flex-col`) so nothing needs horizontal scroll at 375px width
// (PL-040).
export function ProjectsToolbar({
  workspaceId,
  templateOptions,
  searchValue,
  onSearchChange,
}: {
  workspaceId: string;
  templateOptions: TaskTemplatePickerOption[];
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = normalizeView(searchParams.get("view"));

  const handleViewChange = (values: string[]) => {
    // Single-select toggle group: `values` is the newly-pressed value(s).
    // Base UI can report an empty array if the currently-pressed item is
    // clicked again — treat that as "no change" rather than clearing the
    // param, so the toggle can never be left unpressed.
    const next = values[0];
    if (!next) return;

    const params = new URLSearchParams(searchParams.toString());
    if (next === "grid") {
      // Grid is the default — omit the param instead of writing
      // `?view=grid`, matching the pre-existing bookmarked/no-param URL.
      params.delete("view");
    } else {
      params.set("view", next);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {onSearchChange ? (
        // F011 (PL-041): case-insensitive client-side filtering by
        // project name or current phase name, owned by
        // `ProjectsSearchProvider`/`ProjectsView`.
        <input
          type="search"
          placeholder="Search projects…"
          aria-label="Search projects"
          value={searchValue ?? ""}
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:flex-1"
        />
      ) : (
        <input
          type="search"
          placeholder="Search projects…"
          aria-label="Search projects"
          disabled
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:flex-1"
        />
      )}

      {/* F012 (PL-042): `?view=grid|list` toggle — router.replace preserves
          every other existing param (e.g. `?filter=archived`) via the
          URLSearchParams copy above. Grid is the default (no param, or
          any unrecognised value — `normalizeView`). */}
      <ToggleGroup
        aria-label="View"
        value={[view]}
        onValueChange={handleViewChange}
        className="self-start sm:self-auto"
      >
        <ToggleGroupItem value="grid" aria-label="Grid view">
          Grid
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List view">
          List
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="sm:ml-auto">
        <NewProjectDialog
          workspaceId={workspaceId}
          templateOptions={templateOptions}
        />
      </div>
    </div>
  );
}
