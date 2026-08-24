// F230 (AS-435, AS-436, AS-439): My Tasks -- every task assigned to the
// caller across every project in this workspace the caller can see,
// grouped into overdue / today / this week / later.
//
// Server Component, data-fetching only (per the clarified implementation
// pattern) -- getMyTasks (lib/queries/my-tasks.ts) does the real query
// through the RLS-scoped session client, so private-project visibility is
// enforced by `tasks_select_active_members` itself (see that file's own
// comment). No client interactivity is needed for this feature's three
// assertions; F231 (AS-437, AS-438, AS-440, AS-441) adds the per-row
// status-change control, the watched-tasks toggle, archived/trash
// regression tests, and the richer empty state on top of this same page
// and query -- this file intentionally renders a plain (but real, not a
// placeholder) empty state below so F231 has a working page to extend
// rather than a blank one.

import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getMyTasks, type MyTaskRow, type MyTasksBuckets } from "@/lib/queries/my-tasks";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { formatDueDate } from "@/lib/time/user-timezone";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
import { Badge } from "@/components/ui/badge";

const BUCKET_ORDER: { key: keyof MyTasksBuckets; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This week" },
  { key: "later", label: "Later" },
];

export default async function MyTasksPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

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
  const realBuckets = await getMyTasks(workspace.id, user.id, timezone);

  const totalCount = BUCKET_ORDER.reduce(
    (sum, { key }) => sum + realBuckets[key].length,
    0,
  );

  if (totalCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">My Tasks</h1>
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No tasks are assigned to you yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">My Tasks</h1>
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
}: {
  row: MyTaskRow;
  workspaceSlug: string;
  timezone: string;
}) {
  const key = formatTaskKey(row.projectKey, row.number);
  const priority = (row.priority ?? "none") as keyof typeof PRIORITY_LABELS;

  return (
    <Link
      href={`/w/${workspaceSlug}/projects/${row.projectId}/board?taskId=${row.id}`}
      className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
    >
      {key && (
        <span className="font-mono text-xs text-muted-foreground">{key}</span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
      {/* AS-439: which project this task belongs to. */}
      <Badge variant="outline" className="shrink-0">
        {row.projectName}
      </Badge>
      <Badge
        variant="outline"
        className="shrink-0"
        style={{ borderColor: PRIORITY_COLORS[priority], color: PRIORITY_COLORS[priority] }}
      >
        {PRIORITY_LABELS[priority]}
      </Badge>
      <span className="shrink-0 text-xs text-muted-foreground">{row.status}</span>
      {row.dueDate && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDueDate(row.dueDate, timezone)}
        </span>
      )}
    </Link>
  );
}
