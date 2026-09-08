import { logger } from "@/lib/observability/logger";

// F069 (AS-116, AS-119, AS-120): workspace-wide task search page.
//
// Server Component for data-fetching (per the clarified spec) — the search
// box itself is a thin, unnamed submit form (no client JS needed: a GET
// form writes `?q=` and Next re-renders this Server Component with the new
// `searchParams`), keeping the client boundary at zero rather than
// introducing a Client Component just to control an <input>.
//
// Access relies on the workspace-membership layout guard one level up
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — no duplicate
// page-level gate, matching the Projects/List pages' convention.
//
// States (per the clarified spec's four explicit states):
//   - empty query (AS-116's box with nothing typed yet): neutral prompt,
//     not an error and not a "no results" message.
//   - populated: ranked results list, each linking to the matching task's
//     project board (AS-120) — there is no query-param-driven task detail
//     sheet wired into the board page yet (checked components/board/*.tsx
//     and board's page — task opening is local client state, not URL
//     driven), so linking straight to `/w/[slug]/projects/[projectId]/board`
//     is the simplest correct target; the user finds the task highlighted
//     among the board's normal columns from there.
//   - no-match (AS-119): explicit "No tasks match" message, never a blank
//     screen.
//   - error: inline message with a retry link, same convention as
//     ProjectsPage's `loadError` block.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { searchWorkspaceTasks } from "@/lib/queries/search";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_COLORS } from "@/lib/task-colors";
// F146 (AS-258): the single "KEY-NUMBER" formatter — see that file's doc
// comment for why every task-identity surface goes through it instead of
// re-concatenating projectKey/number locally.
import { formatTaskKey } from "@/lib/tasks/task-key";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const q = (query.q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard above already redirects
  // away (via notFound()) when the workspace can't be resolved for this
  // caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  let results: Awaited<ReturnType<typeof searchWorkspaceTasks>> = [];
  let loadError = false;

  // AS-116: an empty query renders the neutral prompt state below without
  // ever calling the search query (no error, no "no results" message).
  if (q) {
    try {
      results = await searchWorkspaceTasks(workspace.id, q);
    } catch (error) {
      logger.error("SearchPage: failed to search tasks", { error: error });
      loadError = true;
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="title-1 font-semibold">Search</h1>
        <p className="text-mini text-muted-foreground">
          Find tasks across every project in {workspace.name}.
        </p>
      </div>

      <form
        action={`/w/${workspaceSlug}/search`}
        method="get"
        className="relative max-w-md"
      >
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search tasks by title or description…"
          aria-label="Search tasks"
          autoFocus
          className="pl-9"
        />
      </form>

      {!q && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center">
          <SearchIcon
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-mini font-medium">Search this workspace</p>
          <p className="text-mini text-muted-foreground">
            Type a task title or description above to get started.
          </p>
        </div>
      )}

      {q && loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-mini text-destructive"
        >
          <p>Something went wrong running your search. Please try again.</p>
          <a
            href={`/w/${workspaceSlug}/search?q=${encodeURIComponent(q)}`}
            className="underline"
          >
            Retry
          </a>
        </div>
      )}

      {q && !loadError && results.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center">
          <p className="text-mini font-medium">No results for &quot;{q}&quot;</p>
          <p className="text-mini text-muted-foreground">
            Try a different title or keyword from the task description.
          </p>
        </div>
      )}

      {q && !loadError && results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((task) => {
            // F223 (AS-417): the task's REAL current column name/colour
            // (lib/queries/search.ts's statusName/statusColor, resolved
            // via status_id against project_statuses), not the raw
            // `status` text — a column rename after this task last wrote
            // its own status must still show the column's current name.
            const statusColor = task.statusColor;
            const priorityColor =
              PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS];
            const taskKey = formatTaskKey(task.projectKey, task.number);

            return (
              <li key={task.id}>
                <Link
                  href={`/w/${workspaceSlug}/projects/${task.projectId}/board`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card p-4 shadow-sm transition-shadow hover:shadow-md hover:ring-1 hover:ring-foreground/20"
                >
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-mini font-medium">
                      {taskKey && (
                        <span className="font-mono text-micro font-normal text-muted-foreground">
                          {taskKey}
                        </span>
                      )}
                      {task.title}
                    </span>
                    <span className="text-mini text-muted-foreground">
                      {task.projectName}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant="outline"
                      className="gap-1.5 capitalize"
                      style={statusColor ? { borderColor: statusColor } : undefined}
                    >
                      {statusColor && (
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: statusColor }}
                        />
                      )}
                      {task.statusName.replace(/_/g, " ")}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="gap-1.5 capitalize"
                      style={priorityColor ? { borderColor: priorityColor } : undefined}
                    >
                      {priorityColor && (
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: priorityColor }}
                        />
                      )}
                      {task.priority}
                    </Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
