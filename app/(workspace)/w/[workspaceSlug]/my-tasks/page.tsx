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
import { getMyTasks, type MyTasksBuckets } from "@/lib/queries/my-tasks";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// Portal-parity fix: the row itself now lives in its own Client Component
// so this page can stay a Server Component — same "row is the only
// interactive part" boundary <TaskListTable> uses for its own rows.
import { MyTaskRowItem } from "@/components/task/my-task-row";
import { PersonalTodoList } from "@/components/my-tasks/personal-todo-list";
import { getPersonalTodos } from "@/lib/queries/personal-todos";
// Portal-parity fix (Type column): the same workspace-scoped task types
// query the project List page uses for its own taskTypeOptions prop.
import { getTaskTypes } from "@/lib/queries/task-types";

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

  // Perf (W9): auth, the workspace-by-slug lookup, and the caller's
  // timezone are independent of each other once `supabase` exists.
  const [
    {
      data: { user },
    },
    { data: workspace },
    timezone,
  ] = await Promise.all([
    supabase.auth.getUser(),
    // RLS-scoped lookup (workspaces_select_active_members) -- same
    // fallback pattern the project List page uses one level up: reaching
    // this route already means the caller is an active member, this just
    // resolves the id.
    supabase.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle(),
    // F124 (AS-207): the viewer's timezone -- bucketing (AS-436) depends
    // on it -- same "resolve once, thread down" convention the project
    // List page follows for its own timezone prop.
    getCurrentUserTimezone(supabase),
  ]);

  if (!workspace || !user) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Unable to load My Tasks.
      </p>
    );
  }

  const [realBuckets, personalTodos, taskTypes] = await Promise.all([
    getMyTasks(workspace.id, user.id, timezone, includeWatched),
    // F416-F418: fetched alongside the task buckets, not as a second
    // client round trip -- same "everything this page needs, in one
    // server render" convention as every other independent-fetches batch
    // in this codebase.
    getPersonalTodos(workspace.id),
    // Portal-parity fix (Type column): fetched alongside the rest of this
    // independent-fetches batch, same as the project List page's own
    // taskTypes fetch.
    getTaskTypes(workspace.id),
  ]);

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

  // F035 (AS-016 fix): the real `tasks.id` values for every task on this
  // page, across all buckets -- threaded down to <PersonalTodoList> so its
  // realtime subscription's tracked-id set is seeded with actual task ids
  // rather than personal-todo ids (which live in a different table and can
  // never match).
  const allTaskIds = BUCKET_ORDER.flatMap(({ key }) => realBuckets[key].map((row) => row.id));

  if (totalCount === 0) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">My Tasks</h1>
        <PersonalTodoList
          workspaceId={workspace.id}
          initialTodos={personalTodos}
          currentUserId={user.id}
          initialTaskIds={allTaskIds}
        />
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
    <div className="flex flex-col gap-6 p-6">
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
      <PersonalTodoList
        workspaceId={workspace.id}
        initialTodos={personalTodos}
        currentUserId={user.id}
        initialTaskIds={allTaskIds}
      />
      {BUCKET_ORDER.map(({ key, label }) => {
        const rows = realBuckets[key];
        if (rows.length === 0) return null;
        return (
          <section key={key} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {label} ({rows.length})
            </h2>
            {/* Portal-parity fix ("My Tasks should look like Dashboard"):
                the same rounded-border <Table> wrapper + header row
                <TaskListTable> uses, instead of the previous bespoke
                divide-y flex list — one row now looks/behaves the same
                whether it's shown here, in the per-project List view, or
                in the workspace Dashboard table. */}
            <div className="rounded-lg border border-border/60 bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Key</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    {/* Portal-parity fix: Type/Estimate/Logged added to
                        match TaskListTable's header exactly. Assignee is
                        intentionally omitted here — every row on this page
                        is already the caller's own task, so an Assignee
                        column would show the same person on every row
                        (same "my X" convention Linear/ClickUp/etc follow
                        for their own "assigned to me" views). */}
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Due date</TableHead>
                    <TableHead className="text-right">Estimate</TableHead>
                    <TableHead className="text-right">Logged</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <MyTaskRowItem
                      key={row.id}
                      row={row}
                      workspaceSlug={workspaceSlug}
                      timezone={timezone}
                      statusOptions={statusOptionsByProject.get(row.projectId)}
                      taskTypeOptions={taskTypes}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
