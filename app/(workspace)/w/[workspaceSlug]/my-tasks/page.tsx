// F230 (AS-435, AS-436, AS-439) + F231 (AS-437, AS-438, AS-440, AS-441):
// My Tasks -- every task assigned to the caller (optionally plus tasks
// they watch) across every project in this workspace the caller can see,
// grouped into overdue / today / this week / later, with an inline
// per-row status change control and a purposeful empty state.
//
// Server Component, data-fetching only -- getMyTasks (lib/queries/
// my-tasks.ts) does the real query through the RLS-scoped session client,
// so private-project visibility (and archived/trash exclusion, AS-437)
// is enforced by the query itself (see that file's own comment). The only
// interactive part is the per-row status select, contained in
// <MyTaskStatusCell>'s own "use client" boundary -- same
// smallest-possible-client-boundary convention as the project List view's
// <ListStatusSelect>.

import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getMyTasks, type MyTaskRow, type MyTasksBuckets } from "@/lib/queries/my-tasks";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { formatDueDate } from "@/lib/time/user-timezone";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MyTaskStatusCell } from "@/components/task/my-task-status-cell";
import type { TaskCardTask } from "@/components/task/task-card";

const BUCKET_ORDER: { key: keyof MyTasksBuckets; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This week" },
  { key: "later", label: "Later" },
];

export type MyTaskStatusOption = { value: string; label: string; color: string };

export default async function MyTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  // F231 (AS-441): "?watched=1" toggles including watched tasks -- state
  // lives in the URL, per this codebase's "state in URL params for
  // anything shareable" convention (same as e.g. list-filters.tsx).
  searchParams: Promise<{ watched?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { watched } = await searchParams;
  const includeWatched = watched === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS-scoped lookup (workspaces_select_active_members) -- same fallback
  // pattern the project List page uses one level up: reaching this route
  // already means the caller is an active member, this just resolves the
  // id.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace || !user) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Unable to load My Tasks.
      </p>
    );
  }

  // F124 (AS-207): the viewer's timezone is resolved first, since
  // bucketing (AS-436) depends on it -- same "resolve once, thread down"
  // convention the project List page follows for its own timezone prop.
  const timezone = await getCurrentUserTimezone(supabase);
  const realBuckets = await getMyTasks(workspace.id, user.id, timezone, includeWatched);

  const totalCount = BUCKET_ORDER.reduce(
    (sum, { key }) => sum + realBuckets[key].length,
    0,
  );

  // F231 (AS-438): per-row status options must resolve against the
  // TASK'S OWN project's columns, never a fixed four or another project's
  // columns (statuses are per-project, F218-F223). Resolved with a single
  // batched query across every distinct project id present in the
  // result -- never a query per row -- and threaded down as a
  // projectId -> options map.
  const distinctProjectIds = Array.from(
    new Set(
      BUCKET_ORDER.flatMap(({ key }) => realBuckets[key].map((row) => row.projectId)),
    ),
  );

  const statusOptionsByProject = new Map<string, MyTaskStatusOption[]>();
  if (distinctProjectIds.length > 0) {
    const { data: columnRows } = await supabase
      .from("project_statuses")
      .select("project_id, name, color, position")
      .in("project_id", distinctProjectIds)
      .order("position", { ascending: true });

    for (const row of columnRows ?? []) {
      const list = statusOptionsByProject.get(row.project_id) ?? [];
      list.push({ value: row.name, label: row.name, color: row.color });
      statusOptionsByProject.set(row.project_id, list);
    }
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">My Tasks</h1>
        {/* F231 (AS-440): a purposeful empty state with a primary action,
            not a dead end -- links to Projects so the caller can go find
            work to pick up, per the shared empty-state convention
            (components/board/board-empty-state.tsx). Reached via the
            real getMyTasks zero-row path, not a placeholder. */}
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium">
            {includeWatched
              ? "No tasks are assigned to you or watched by you yet."
              : "No tasks are assigned to you yet."}
          </p>
          <p className="text-sm text-muted-foreground">
            Tasks show up here once someone assigns them to you{includeWatched ? ", or once you watch one" : ""}.
          </p>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/w/${workspaceSlug}/projects`}>Browse projects</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">My Tasks</h1>
        {/* F231 (AS-441): toggle is a plain link that flips the URL
            search param -- no client component needed for navigation. */}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link
              href={
                includeWatched
                  ? `/w/${workspaceSlug}/my-tasks`
                  : `/w/${workspaceSlug}/my-tasks?watched=1`
              }
            >
              {includeWatched ? "Hide watched tasks" : "Include tasks I watch"}
            </Link>
          }
        />
      </div>
      {BUCKET_ORDER.map(({ key, label }) => {
        const rows = realBuckets[key];
        if (rows.length === 0) return null;
        return (
          <section key={key} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {label} ({rows.length})
            </h2>
            <div className="rounded-lg border border-border/60 bg-card divide-y">
              {rows.map((row) => (
                <MyTaskRowItem
                  key={row.id}
                  row={row}
                  workspaceSlug={workspaceSlug}
                  timezone={timezone}
                  statusOptions={statusOptionsByProject.get(row.projectId)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MyTaskRowItem({
  row,
  workspaceSlug,
  timezone,
  statusOptions,
}: {
  row: MyTaskRow;
  workspaceSlug: string;
  timezone: string;
  statusOptions?: MyTaskStatusOption[];
}) {
  const key = formatTaskKey(row.projectKey, row.number);
  const priority = (row.priority ?? "none") as keyof typeof PRIORITY_LABELS;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
      <Link
        href={`/w/${workspaceSlug}/projects/${row.projectId}/board?taskId=${row.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {key && (
          <span className="font-mono text-xs text-muted-foreground">{key}</span>
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
      </Link>
      {/* AS-439: which project this task belongs to. */}
      <Badge variant="outline" className="shrink-0">
        {row.projectName}
      </Badge>
      {/* F231 (AS-441): visually distinguish a watched-only row (not
          assigned) from an assigned one, per the clarified answer. A task
          that is both assigned and watched shows only the assigned
          styling (assignment is the primary reason it's on this page). */}
      {row.isWatched && !row.isAssigned && (
        <Badge variant="secondary" className="shrink-0">
          Watching
        </Badge>
      )}
      <Badge
        variant="outline"
        className="shrink-0"
        style={{ borderColor: PRIORITY_COLORS[priority], color: PRIORITY_COLORS[priority] }}
      >
        {PRIORITY_LABELS[priority]}
      </Badge>
      {/* F231 (AS-438): inline status change, resolved against THIS row's
          own project's columns. */}
      <MyTaskStatusCell
        taskId={row.id}
        status={row.status as TaskCardTask["status"]}
        statusOptions={statusOptions}
      />
      {row.dueDate && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDueDate(row.dueDate, timezone)}
        </span>
      )}
    </div>
  );
}
