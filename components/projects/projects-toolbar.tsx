import { NewProjectDialog } from "@/components/new-project-dialog";
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";

// F010 (PL-040): toolbar row for the Projects page — search input (left,
// grows to fill available space), view toggle (middle) and New Project
// (right). The view toggle is still a static placeholder (F012 wires up
// the `?view=` toggle). The search input is a real, controlled input as
// of F011 (PL-041) — wired up by `ProjectsToolbarWithSearch`
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

      {/* Static placeholder — F012 (PL-042) wires this up to `?view=`
          routing (grid is the default). Plain radio inputs rather than the
          client-only ToggleGroup primitive so this toolbar can stay a
          Server Component until F012 lands. */}
      <div
        role="radiogroup"
        aria-label="View"
        className="flex items-center gap-1 self-start rounded-md border border-border bg-secondary p-1 sm:self-auto"
      >
        <label className="flex cursor-not-allowed items-center gap-1.5 rounded px-2 py-1 text-sm text-foreground">
          <input
            type="radio"
            name="projects-view"
            value="grid"
            defaultChecked
            disabled
            aria-label="Grid view"
          />
          Grid
        </label>
        <label className="flex cursor-not-allowed items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground">
          <input
            type="radio"
            name="projects-view"
            value="list"
            disabled
            aria-label="List view"
          />
          List
        </label>
      </div>

      <div className="sm:ml-auto">
        <NewProjectDialog
          workspaceId={workspaceId}
          templateOptions={templateOptions}
        />
      </div>
    </div>
  );
}
