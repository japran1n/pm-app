"use client";

// F009 (AS-021, AS-022, AS-024): the shared project page's task list, kept
// live via Realtime on `tasks` -- a status/title edit lands without a
// reload (AS-021), and a task that stops being shareable (deleted, or
// `client_visible` flipped to false) disappears from the list the same way
// (AS-022). Seeded entirely from the server-rendered `project` prop; the
// subscription only ever patches that seed, it never re-fetches.
//
// Membership (does this row belong on THIS project's page at all) is
// delegated to F007's `reconcilePortalRealtimeTask` -- the same
// `client_visible && !deleted_at` gate the "Waiting on you" surface (F008)
// uses, plus this surface's own predicate: the row's `project_id` matches
// the project this page is showing. Hand-rolling that gate a second time
// here is exactly the drift F007 exists to prevent.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  PortalProject,
  PortalTask,
  StatusCategory,
} from "@/lib/queries/portal";
import { clientStatusLabel } from "@/components/portal/status-label";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";
import {
  reconcilePortalRealtimeTask,
  type PortalRealtimeRow,
} from "@/lib/portal/reconcile-portal-realtime-task";

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Tasks are grouped by the *name* of the board column they sit in, so the
// client sees the team's own vocabulary ("In review", "Blocked") rather
// than a translated set of generic buckets. The groups are then ordered by
// category — in progress first, then not started, then done — because
// "what is happening now" is the question a client opens this page to
// answer, and finished work reads as history.
const CATEGORY_RANK: Record<StatusCategory, number> = {
  in_progress: 0,
  not_started: 1,
  done: 2,
};

type TaskGroup = {
  statusName: string;
  category: StatusCategory;
  tasks: PortalTask[];
};

function groupTasks(tasks: PortalTask[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const existing = groups.get(task.status);
    if (existing) {
      existing.tasks.push(task);
    } else {
      groups.set(task.status, {
        statusName: task.status,
        category: task.category,
        tasks: [task],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category],
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// The shape this surface tracks Realtime membership over: the fields
// `reconcilePortalRealtimeTask` needs (`client_visible`, `deleted_at`),
// plus `project_id` for this page's own predicate, layered on top of the
// rendered `PortalTask` fields. The server-rendered seed is already
// filtered to visible/non-deleted rows for this project, so those three
// fields are synthesized as constants at seed time.
type LiveTask = PortalTask & PortalRealtimeRow & { project_id: string };

function seedLiveTasks(project: PortalProject): LiveTask[] {
  return project.tasks.map((task) => ({
    ...task,
    project_id: project.id,
    client_visible: true,
    deleted_at: null,
  }));
}

// Raw `tasks` row shape as it arrives over Realtime -- snake_case columns,
// no join to `project_statuses`, so no `category`. `hasValidId` in F007's
// module already guards the primitive shape; this type just documents what
// this handler reads off it before handing a merged record to the
// reconciler.
type RawTaskRow = {
  id: string;
  title?: string;
  status?: string;
  status_id?: string | null;
  due_date?: string | null;
  project_id?: string;
  client_visible: boolean | null;
  deleted_at: string | null;
  [key: string]: unknown;
};

// Status -> category lookup, built once from the server-rendered project's
// `statuses` (the project's board columns), independent of which columns
// currently hold a shared task. Looked up by `status_id` first (stable
// across a column rename), falling back to the status *name* for the same
// reason `getPortalProjects` does server-side.
type CategoryLookup = {
  byId: Map<string, StatusCategory>;
  byName: Map<string, StatusCategory>;
};

function buildCategoryLookup(
  statuses: PortalProject["statuses"],
): CategoryLookup {
  const byId = new Map<string, StatusCategory>();
  const byName = new Map<string, StatusCategory>();
  for (const status of statuses) {
    byId.set(status.id, status.category);
    byName.set(status.name, status.category);
  }
  return { byId, byName };
}

function resolveCategory(
  lookup: CategoryLookup,
  statusId: string | null | undefined,
  statusName: string | undefined,
  fallback: StatusCategory,
): StatusCategory {
  if (statusId && lookup.byId.has(statusId)) {
    return lookup.byId.get(statusId)!;
  }
  if (statusName && lookup.byName.has(statusName)) {
    return lookup.byName.get(statusName)!;
  }
  return fallback;
}

function mergeIncomingTask(
  raw: RawTaskRow,
  existing: LiveTask | undefined,
  fallbackProjectId: string,
  categoryLookup: CategoryLookup,
): LiveTask {
  const status = raw.status ?? existing?.status ?? "";
  const statusId =
    raw.status !== undefined ? (raw.status_id ?? null) : (existing?.statusId ?? null);
  return {
    id: raw.id,
    title: raw.title ?? existing?.title ?? "",
    status,
    statusId,
    dueDate:
      raw.due_date !== undefined ? raw.due_date : (existing?.dueDate ?? null),
    // Resolved against this project's status->category lookup so a task
    // moved into a different column (e.g. a Done column) is grouped,
    // labelled and overdue-styled correctly the moment the Realtime UPDATE
    // arrives -- not just after a reload re-seeds it from the server. Only
    // when the incoming status is genuinely unknown to this project's
    // lookup does it fall back to the last-known (or "not_started" for a
    // never-seen task) category.
    category: resolveCategory(
      categoryLookup,
      statusId,
      status,
      existing?.category ?? "not_started",
    ),
    project_id: raw.project_id ?? existing?.project_id ?? fallbackProjectId,
    client_visible: raw.client_visible,
    deleted_at: raw.deleted_at,
  };
}

export function subscribeToPortalTaskListRealtime(
  supabase: SupabaseClient,
  projectId: string,
  onChange: (updater: (current: LiveTask[]) => LiveTask[]) => void,
  categoryLookup: CategoryLookup,
): () => void {
  const topic = `portal:project:${projectId}:tasks`;

  return acquireSharedTopicChannel<RealtimePostgresChangesPayload<RawTaskRow>>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          (payload: RealtimePostgresChangesPayload<RawTaskRow>) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    (event) => {
      onChange((current) => {
        if (event.eventType === "DELETE") {
          return reconcilePortalRealtimeTask(
            current,
            event as unknown as RealtimePostgresChangesPayload<LiveTask>,
            (row) => row.project_id === projectId,
          );
        }

        const raw = event.new as RawTaskRow;
        if (!raw || typeof raw.id !== "string" || raw.id.length === 0) {
          return current;
        }
        const existing = current.find((task) => task.id === raw.id);
        const merged = mergeIncomingTask(raw, existing, projectId, categoryLookup);

        const syntheticEvent = {
          ...event,
          new: merged,
        } as unknown as RealtimePostgresChangesPayload<LiveTask>;

        return reconcilePortalRealtimeTask(
          current,
          syntheticEvent,
          (row) => row.project_id === projectId,
        );
      });
    },
  );
}

export function PortalTaskList({
  project,
  workspaceSlug,
}: {
  project: PortalProject;
  workspaceSlug: string;
}) {
  const [tasks, setTasks] = useState<LiveTask[]>(() => seedLiveTasks(project));
  // A fresh server-rendered project (e.g. navigating between projects, or
  // the RSC re-rendering after a mutation) always wins over whatever this
  // session's subscription has accumulated so far -- tracked so the reset
  // can happen during render rather than in a post-commit effect.
  const [seededProject, setSeededProject] = useState(project);
  if (project !== seededProject) {
    setSeededProject(project);
    setTasks(seedLiveTasks(project));
  }

  useEffect(() => {
    const supabase = createClient();
    // F023: awaits session hydration before subscribing (see
    // lib/realtime/subscribe-when-authenticated.ts) -- without it, a
    // channel created on a fresh page load joins unauthenticated and
    // every RLS-gated UPDATE this subscription exists to deliver (AS-021,
    // AS-022) is silently filtered out.
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToPortalTaskListRealtime(
        client,
        project.id,
        setTasks,
        buildCategoryLookup(project.statuses),
      ),
    );
  }, [project.id, project.statuses]);

  const groups = groupTasks(tasks);
  const today = todayIso();

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing shared yet"
        description="The team has not shared any items from this project with you."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium tracking-tight">Shared with you</h2>

      {groups.map(({ statusName, category, tasks: groupTasksList }) => (
        <section key={statusName} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {clientStatusLabel(category, statusName)} ({groupTasksList.length})
          </h3>

          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {groupTasksList.map((task) => {
              // Only unfinished work can be late. A delivered task keeps
              // its date as plain history.
              const overdue = Boolean(
                task.category !== "done" && task.dueDate && task.dueDate < today,
              );
              return (
                <li key={task.id}>
                  <Link
                    href={`/portal/${workspaceSlug}/p/${project.id}/t/${task.id}`}
                    className="hover-surface flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <span className="text-sm">{task.title}</span>
                    {task.dueDate && (
                      <span
                        className={
                          overdue
                            ? "shrink-0 text-xs font-medium text-destructive"
                            : "shrink-0 text-xs text-muted-foreground"
                        }
                      >
                        {formatDate(task.dueDate)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
