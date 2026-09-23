import { NewProjectDialog } from "@/components/new-project-dialog";
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";

// F010 (PL-040): toolbar row for the Projects page — search input (left,
// grows to fill available space), view toggle (middle) and New Project
// (right). This is a Server Component wrapper: the search input and the
// view toggle are static placeholders for now (F011 wires up client-side
// filtering, F012 wires up the `?view=` toggle) — only `NewProjectDialog`
// is interactive today, same as before this feature.
//
// Layout: row (`flex-row`) with the search input taking the remaining
// space (`flex-1`) once there's room; below the `sm` breakpoint the row
// stacks (`flex-col`) so nothing needs horizontal scroll at 375px width
// (PL-040).
export function ProjectsToolbar({
  workspaceId,
  templateOptions,
}: {
  workspaceId: string;
  templateOptions: TaskTemplatePickerOption[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* Static placeholder — F011 (PL-041) wires up case-insensitive
          client-side filtering by name/phase. */}
      <input
        type="search"
        placeholder="Search projects…"
        aria-label="Search projects"
        disabled
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:flex-1"
      />

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
