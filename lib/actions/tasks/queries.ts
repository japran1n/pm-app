"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteTaskSchema,
  getOpenBlockersSchema,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { type ActionResult, withAuthz } from "@/lib/actions/authz";
import { type WorkspaceRole } from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import { isDoneStatus } from "@/lib/tasks/blocked-guard";
import type { TaskDetailSheetTask } from "@/components/task/task-detail-sheet";
import type { TaskComment } from "@/components/task/comment-list";
import type { TaskAttachment } from "@/components/task/attachment-list";
import type { SubtaskListChildTask } from "@/components/task/subtask-list";
import type { ChecklistListItem } from "@/components/task/checklist";
import type { DependencyRelatedTask } from "@/components/task/dependencies";

export type GetOpenBlockersResult = ActionResult<DependencyRelatedTask[]>;

// F158 (AS-280, AS-281): the ONE server-side source of "which of this
// task's blockers are still open (not done, not soft-deleted)" — called
// by components/task/blocked-done-guard.tsx's useBlockedDoneGuard hook
// (see lib/tasks/blocked-guard.ts's isDoneStatus doc comment for the
// full list of callers: board drag-and-drop, the list view's inline
// status select, the task detail sheet's own status Select, and a
// future bulk update), never re-queried ad hoc from board.tsx/
// list-status-select.tsx/task-detail-sheet.tsx themselves.
//
// Mirrors getTaskDetail's own blockedByQuery below almost exactly (same
// FK-disambiguated embed via task_dependencies_blocking_task_id_fkey,
// same soft-delete filter) — deliberately NOT reused as a shared query
// function between the two. getTaskDetail fetches BOTH directions
// (blockedBy + blocks) plus seven other sections in a single big
// Promise.all for the whole task-detail sheet; this action's entire job
// is one fast lookup at the moment of an actual status-change attempt.
// Routing every caller of this guard through getTaskDetail's much
// heavier shape would cost board.tsx/list-status-select.tsx (which have
// no other use for a task's comments/attachments/checklist/subtasks) an
// unnecessary fetch of all of that, every single time a user tries to
// complete a task — the opposite of this feature's own performance
// budget ("no per-item network call" only holds if this stays a small,
// single-purpose lookup).
//
// "Open" here means the SAME thing lib/queries/tasks.ts's
// getProjectBoardTasks already established for the board card's AS-283
// indicator: a blocker whose own status isn't done (isDoneStatus,
// lib/tasks/blocked-guard.ts — the one place this comparison lives, per
// that file's F222 sweep note) and that hasn't been soft-deleted.
//
// Pattern otherwise mirrors moveTaskStatus/reorderTask above: Zod-
// validated input, membership re-checked server-side (defense in depth,
// AS-143), admin client for the read (RLS would also allow this same
// read for an active member, same rationale as getTaskDetail), generic
// user-facing errors with details only logged server-side (AS-146). Any
// active workspace member may check any task's blockers in that
// workspace — no per-task ownership check, same convention as every
// other read/write in this file.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. A pure read, so `requireWrite` is
// left at its default `false`; only membership + F323 visibility gate it.
const getOpenBlockersImpl = withAuthz(
  getOpenBlockersSchema,
  {
    membershipError: "You don't have permission to view this task.",
    requireVisibility: true,
    // F323 (AS-227, AS-228, AS-229): read-path confidentiality — returns
    // the SAME "Task not found" message this function already uses for a
    // genuinely missing/deleted task (never a permission-denied message),
    // so a read-path leak never even confirms the task exists.
    visibilityError: "Task not found.",
    // Same task -> project -> workspace lookup convention as
    // moveTaskStatus/reorderTask/etc. — the real owning workspace is
    // resolved server-side, never trusted from the client. A soft-deleted
    // task behaves as "not found".
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<GetOpenBlockersResult> => {
    // Same blocked_task_id -> blocking task embed + FK disambiguation as
    // getTaskDetail's own blockedByQuery below (F155's two same-table FKs,
    // task_dependencies_blocking_task_id_fkey/_blocked_task_id_fkey).
    // F222 (AS-410): `status_id, project_statuses(category)` added to the
    // embedded `blocking` task so "is this blocker still open" is decided
    // by the blocker's own column CATEGORY, not the literal string "done"
    // — same fallback rule as every other call site
    // (lib/tasks/status-category.ts's isDoneStatus).
    const { data: rows, error: blockersError } = await ctx.admin
      .from("task_dependencies")
      .select(
        "id, blocking:tasks!task_dependencies_blocking_task_id_fkey(id, title, status, status_id, number, deleted_at, projects(key), project_statuses(category))",
      )
      .eq("blocked_task_id", input.taskId);

    if (blockersError) {
      logger.error("getOpenBlockers: dependency fetch failed", { error: blockersError });
      return {
        ok: false,
        error:
          "Something went wrong checking this task's blockers. Please try again.",
      };
    }

    const openBlockers: DependencyRelatedTask[] = (rows ?? [])
      .map((row) => {
        const blocking = Array.isArray(row.blocking)
          ? row.blocking[0]
          : row.blocking;
        const blockingStatusCategory = Array.isArray(blocking?.project_statuses)
          ? blocking.project_statuses[0]?.category
          : blocking?.project_statuses?.category;
        if (
          !blocking ||
          blocking.deleted_at ||
          isDoneStatus(blocking.status, blockingStatusCategory)
        ) {
          return null;
        }
        const blockingProject = Array.isArray(blocking.projects)
          ? blocking.projects[0]
          : blocking.projects;
        const related: DependencyRelatedTask = {
          dependencyId: row.id,
          taskId: blocking.id,
          title: blocking.title,
          status: blocking.status as DependencyRelatedTask["status"],
          projectKey: blockingProject?.key,
          number: blocking.number,
        };
        return related;
      })
      .filter((row): row is DependencyRelatedTask => row !== null);

    return { ok: true, data: openBlockers };
  },
);

export async function getOpenBlockers(
  taskId: string,
): Promise<GetOpenBlockersResult> {
  return getOpenBlockersImpl({ taskId });
}

// BUGFIX (TaskDetailSheet was fully built but never rendered anywhere):
// on-demand fetch of one task's full detail — every field
// TaskDetailSheet's props interface needs beyond what the board/list's
// summary queries (getProjectBoardTasks/getProjectListTasks,
// lib/queries/tasks.ts) already carry, plus its comments and attachments —
// in a single round trip, called from the client the moment a TaskCard is
// clicked and the sheet opens. Mirrors this file's other Server Actions:
// Zod-validated input (deleteTaskSchema's shape — just a task id — is
// reused since this action takes the identical single-field input),
// admin client for the reads (RLS would also allow these same reads for an
// active member, per the same rationale documented on editTask/addComment/
// etc.), discriminated-union return, generic user-facing errors with
// details only logged server-side (AS-146).
//
// Unlike the mutating actions in this file, this is a pure read — but it
// still independently re-verifies the caller is an active member of the
// task's owning workspace (defense in depth, AS-143) before returning any
// task/comment/attachment data, exactly like every other action here.
//
// Comments/attachments are fetched non-deleted-only and ordered the same
// way their respective components' doc comments already assume:
// CommentList expects oldest-first (AS-096); AttachmentList has no
// ordering assertion of its own, so created_at ascending (upload order) is
// used for the same "oldest/first-uploaded first" consistency.
//
// Attachment signed URLs (AS-108: never a permanent public URL) are minted
// here for every attachment up front, same bucket/TTL convention as
// lib/actions/attachments.ts's uploadAttachment/getAttachmentSignedUrl —
// re-exported from that file rather than duplicated. AttachmentList's
// per-row "Open" click still re-mints its own fresh signed URL on demand
// (unchanged), so a URL returned here going stale after
// SIGNED_URL_TTL_SECONDS while the sheet stays open is not a functional
// problem — it's read once for the initial render's implicit "did this
// file resolve" info and is not otherwise exercised by this codebase's
// existing components (both TaskDetailSheet and AttachmentList only ever
// call getAttachmentSignedUrl for actually opening a file).
export type GetTaskDetailResult = ActionResult<{
        task: TaskDetailSheetTask;
        comments: TaskComment[];
        attachments: TaskAttachment[];
        currentUserId: string;
        // F128 (AS-216): widened from "owner" | "admin" | "member" to the
        // full WorkspaceRole (adds "viewer" | "guest") — see
        // lib/auth/require-membership.ts's matching widening.
        currentUserRole: WorkspaceRole;
      }>;

export async function getTaskDetail(
  taskId: string,
): Promise<GetTaskDetailResult> {
  const parsed = deleteTaskSchema.safeParse({ taskId });

  if (!parsed.success) {
    return { ok: false, error: "Invalid task." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to view this task." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Same task-scoped -> project -> workspace lookup convention as every
  // other action in this file (editTask, deleteTask, etc.) — the real
  // owning workspace is resolved server-side, never trusted from the
  // client. A soft-deleted task behaves as "not found".
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      // F146 (AS-258): `number` and the joined `key` are selected here
      // via this action's existing task+project fetch — no second round
      // trip for the detail header's task-key badge.
      // F150 (AS-263, AS-264): `project_id` (needed by the Subtasks
      // section's add-subtask form to call createTask) and
      // `parent_task_id` (drives whether the parent-lookup query below
      // runs at all) are selected here for the exact same "one query,
      // not a second round trip" reason.
      // F167 follow-up: `estimate_minutes` added here so
      // TaskDetailSheetTask.estimateMinutes (F167's UI, previously always
      // undefined on this path) actually receives real data — see this
      // function's mapping below.
      // F171 (AS-307, AS-309): `description_json` added here so the detail
      // sheet can render the safe, formatted Tiptap document via
      // RichTextRenderer instead of only ever showing the plain-text
      // `description` column — same "one query, no second round trip"
      // convention as every other field on this select. F170 backfills
      // and keeps this column in sync via a DB trigger, so it always
      // exists (an empty `{ type: "doc", content: [] }` doc for
      // null/empty descriptions), never null-vs-column-missing.
      // F179 (AS-317, AS-318, AS-319): `recurrence`/`recurrence_parent_id`
      // added here so the detail sheet's recurrence picker/remove control
      // and the occurrence-to-source link both read real data instead of
      // always-undefined — same "one query, no second round trip"
      // convention as every other field on this select.
      // F222 (AS-410): `status_id, project_statuses(category)` added so
      // TaskDetailSheetTask.statusCategory (isOverdue's category-aware
      // check) gets real data — same "one query, no second round trip"
      // convention as every other field on this select.
      // F005 (missions/20260903-portal, AS-014): `page_slug`/`page_order`
      // (this task's own portal-Pages-view ordering/identity) and
      // `task_types(name, system_key)` (this task's TYPE, both its
      // display name AND its stable `system_key` — F006c/AS-014 gates
      // the detail sheet's page fields on `system_key = 'page'`, NOT the
      // name, so a workspace whose page type is named "Sida" still shows
      // and orders them; `name` is kept for display/logging elsewhere)
      // — one extra join, no second round trip, same convention as
      // every other field on this select.
      // F006c (missions/20260903-portal, AS-013): `phase_id` — this
      // task's own phase assignment. Selected here for the first time;
      // `setTaskPhase` (lib/actions/phases.ts) has written this column
      // since F002, but nothing ever read it back until now, which is
      // exactly why AS-013 never actually held (see this feature's
      // spec/handoff).
      // F118 (AS-066): `task_type_id` added so the detail sheet's type
      // editor has a real value to hand to setTaskType — task_types(...)
      // below already carries the display name/system_key but not the
      // id itself.
      "id, title, description, description_json, status, status_id, priority, assignee_id, due_date, start_date, tags, number, project_id, parent_task_id, deleted_at, estimate_minutes, recurrence, recurrence_parent_id, client_visible, pending_client_approval, page_slug, page_order, phase_id, task_type_id, blocked_reason, billable, task_types(name, system_key), projects!inner(key, workspace_id, visibility), project_statuses(category)",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { key: string; workspace_id: string; visibility: ProjectVisibility | null }
    | { key: string; workspace_id: string; visibility: ProjectVisibility | null }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to view this task.",
    };
  }

  // F323 (AS-227, AS-228, AS-229): read-path confidentiality — the caller
  // must be able to SEE this task's project themselves, not just be an
  // active workspace member (see isProjectVisibleToCaller's doc comment in
  // lib/actions/project-visibility.ts). Returns the SAME "Task not found"
  // message this function already uses for a genuinely missing/deleted
  // task (never a permission-denied message), so a read-path leak never
  // even confirms the task exists.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: taskRow.project_id,
        visibility: projectRow?.visibility ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return { ok: false, error: "Task not found." };
  }

  // F150 (AS-264): this task's own live children (subtasks), fetched here
  // — inside getTaskDetail's existing single detail-fetch — rather than a
  // per-child round trip once the Subtasks section renders. A task that
  // is itself a child can never have children of its own (F148's
  // one-level nesting limit, enforced by enforce_task_parent_rules()), so
  // this query harmlessly returns zero rows for a child task rather than
  // needing its own conditional branch.
  // F222 (AS-410): `status_id, project_statuses(category)` added so the
  // Subtasks section's "N of M done" count (countSubtaskProgress) is
  // category-aware — see this feature's status-category.ts.
  const childrenQuery = admin
    .from("tasks")
    .select(
      "id, title, status, status_id, assignee_id, number, project_statuses(category)",
    )
    .eq("parent_task_id", parsed.data.taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  // F153 (AS-269 UI half): this task's own checklist items, fetched here
  // in getTaskDetail's existing single detail-fetch, same convention as
  // `childrenQuery` immediately above — the checklist UI (components/
  // task/checklist.tsx) never queries Supabase directly, it only renders
  // whatever this Server Action hands it (Clarified implementation's
  // Data shape answer). Position-ascending, since that's the order
  // AS-269/AS-271 expect the checklist to render and reorder in — the
  // same `(task_id, position)` composite index F151's migration created
  // for exactly this query shape.
  const checklistQuery = admin
    .from("checklist_items")
    .select("id, content, is_checked, position")
    .eq("task_id", parsed.data.taskId)
    .order("position", { ascending: true });

  // F150 (AS-263): only run the parent lookup when this task actually
  // has one — a top-level task's parent_task_id is null, so there is
  // nothing to look up (`parentQuery` stays null and the resolved
  // `parentResult.data` below stays null too).
  const parentQuery = taskRow.parent_task_id
    ? admin
        .from("tasks")
        .select("id, title, number")
        .eq("id", taskRow.parent_task_id)
        .is("deleted_at", null)
        .maybeSingle()
    : null;

  // F179 (AS-318): only run the recurrence-source lookup when this task
  // is itself a GENERATED OCCURRENCE (`recurrence_parent_id` set, F177's
  // handoff: it always points at the series ROOT, never an intermediate
  // occurrence) — a top-level/root recurring task's own
  // `recurrence_parent_id` is null, so there is nothing to look up, same
  // "conditional query" convention as `parentQuery` immediately above.
  const recurrenceSourceQuery = taskRow.recurrence_parent_id
    ? admin
        .from("tasks")
        .select("id, title, number")
        .eq("id", taskRow.recurrence_parent_id)
        .is("deleted_at", null)
        .maybeSingle()
    : null;

  // F157 (AS-277): this task's own dependency rows, in BOTH directions,
  // fetched here in getTaskDetail's existing single detail-fetch — same
  // "one query per section, no per-row round trip" convention as
  // `childrenQuery`/`checklistQuery` above. `task_dependencies` has TWO
  // foreign keys to `tasks` (blocking_task_id, blocked_task_id), so each
  // embedded `tasks` relation below is disambiguated with PostgREST's
  // `!constraint_name` hint (the auto-generated FK names from F155's
  // migration: task_dependencies_blocking_task_id_fkey/
  // _blocked_task_id_fkey — confirmed against
  // lib/supabase/database.types.ts's own Relationships entries for this
  // table) and aliased so the result shape is self-describing.
  //
  // The related task's OWN project key is fetched via its own nested
  // `projects(key)` join, NOT assumed to equal this task's projectKey —
  // unlike a subtask/parent pair (always the same project,
  // enforce_task_parent_rules()), a dependency's two tasks are only
  // guaranteed to share a WORKSPACE (AS-285), not a project, so the
  // related task can carry a different key.
  const blockedByQuery = admin
    .from("task_dependencies")
    .select(
      "id, blocking:tasks!task_dependencies_blocking_task_id_fkey(id, title, status, number, deleted_at, projects(key))",
    )
    .eq("blocked_task_id", parsed.data.taskId)
    .order("created_at", { ascending: true });

  const blocksQuery = admin
    .from("task_dependencies")
    .select(
      "id, blocked:tasks!task_dependencies_blocked_task_id_fkey(id, title, status, number, deleted_at, projects(key))",
    )
    .eq("blocking_task_id", parsed.data.taskId)
    .order("created_at", { ascending: true });

  // F161 follow-through (AS-287, AS-288): this task's full current
  // assignee set, oldest-first — same ordering `setTaskAssigneesCore`'s
  // mirror rule and the board RPC's `assignee_ids` column both use (see
  // that RPC's migration for the identical tie-break), so the detail
  // sheet's assignee picker shows the same set/order as the card it was
  // opened from. Fetched here in getTaskDetail's existing single
  // detail-fetch, same "one query per section, no per-row round trip"
  // convention as every other section above.
  const assigneesQuery = admin
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.data.taskId)
    .order("created_at", { ascending: true });

  // F165 (AS-297): this task's CURRENT watcher set — `is_watching = true`
  // only, per F164's own durability rule (a row can exist with
  // `is_watching: false` for an explicit opt-out; that must never surface
  // as "watching" here). Same "one query per section, fetched once with
  // the task" convention as `assigneesQuery` immediately above — no
  // second round trip from the Watchers component below.
  const watchersQuery = admin
    .from("task_watchers")
    .select("user_id")
    .eq("task_id", parsed.data.taskId)
    .eq("is_watching", true)
    .order("created_at", { ascending: true });

  const [
    commentsResult,
    attachmentsResult,
    childrenResult,
    parentResult,
    recurrenceSourceResult,
    checklistResult,
    blockedByResult,
    blocksResult,
    assigneesResult,
    watchersResult,
  ] = await Promise.all([
    admin
      .from("comments")
      // F303 follow-up (D3/FU-1, AS-363): `edited_at` and `body_json`
      // added — previously omitted, which is why the "(edited)" marker and
      // rich-text body only ever survived within the posting session and
      // silently reverted on reload (getTaskDetail never carried them).
      .select("id, task_id, user_id, text, body_json, created_at, edited_at")
      .eq("task_id", parsed.data.taskId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("attachments")
      .select("id, task_id, file_url, file_name, uploaded_by, created_at, mime_type")
      .eq("task_id", parsed.data.taskId)
      .order("created_at", { ascending: true }),
    childrenQuery,
    parentQuery ?? Promise.resolve({ data: null, error: null }),
    recurrenceSourceQuery ?? Promise.resolve({ data: null, error: null }),
    checklistQuery,
    blockedByQuery,
    blocksQuery,
    assigneesQuery,
    watchersQuery,
  ]);

  if (commentsResult.error) {
    logger.error("getTaskDetail: comments fetch failed", { error: commentsResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  // F303 follow-up (D3/FU-1, AS-365, AS-366): batched fetch of every
  // comment's reactions in ONE query (not one query per comment — same
  // batch-then-group-in-TS convention as
  // lib/comments/mentions.ts's resolveVisibleMentionIds and
  // lib/queries/notifications.ts's actor/task batching), grouped here by
  // `comment_id` then `emoji` into exactly `CommentReactionSummary`'s
  // shape (components/task/comment-reactions.tsx) so `TaskComment.reactions`
  // is directly assignable with no second, incompatible shape. Skipped
  // entirely when this task has no comments (nothing to react to).
  const commentIds = (commentsResult.data ?? []).map((row) => row.id);
  const reactionsByCommentId = new Map<string, Map<string, string[]>>();
  if (commentIds.length > 0) {
    const { data: reactionRows, error: reactionsError } = await admin
      .from("comment_reactions")
      .select("comment_id, user_id, emoji")
      .in("comment_id", commentIds)
      .order("created_at", { ascending: true });

    if (reactionsError) {
      logger.error("getTaskDetail: reactions fetch failed", { error: reactionsError });
      return {
        ok: false,
        error: "Something went wrong loading this task. Please try again.",
      };
    }

    for (const row of reactionRows ?? []) {
      let byEmoji = reactionsByCommentId.get(row.comment_id);
      if (!byEmoji) {
        byEmoji = new Map<string, string[]>();
        reactionsByCommentId.set(row.comment_id, byEmoji);
      }
      const userIds = byEmoji.get(row.emoji);
      if (userIds) {
        userIds.push(row.user_id);
      } else {
        byEmoji.set(row.emoji, [row.user_id]);
      }
    }
  }

  if (attachmentsResult.error) {
    logger.error("getTaskDetail: attachments fetch failed", { error: attachmentsResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (childrenResult.error) {
    logger.error("getTaskDetail: children fetch failed", { error: childrenResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (parentResult.error) {
    logger.error("getTaskDetail: parent fetch failed", { error: parentResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (recurrenceSourceResult.error) {
    logger.error("getTaskDetail: recurrence source fetch failed", { error: recurrenceSourceResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (checklistResult.error) {
    logger.error("getTaskDetail: checklist fetch failed", { error: checklistResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (blockedByResult.error) {
    logger.error("getTaskDetail: blocked-by dependencies fetch failed", { error: blockedByResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (blocksResult.error) {
    logger.error("getTaskDetail: blocks dependencies fetch failed", { error: blocksResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (assigneesResult.error) {
    logger.error("getTaskDetail: assignees fetch failed", { error: assigneesResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (watchersResult.error) {
    logger.error("getTaskDetail: watchers fetch failed", { error: watchersResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  // F157 (AS-277): a soft-deleted related task (deleted_at set, but the
  // row not physically removed — task_dependencies' `on delete cascade`
  // only fires on a genuine hard DELETE, per F155's own handoff note)
  // must not surface as a live-looking row here. Filtered in TypeScript
  // rather than a PostgREST embedded-resource filter, since this is a
  // single whole-task query either way (no per-row round trip either
  // way) and a plain `.filter()` is simpler than an `!inner` join plus
  // dot-path filter for a two-row-shape (object-or-array) embed.
  const blockedBy: DependencyRelatedTask[] = (blockedByResult.data ?? [])
    .map((row) => {
      const blocking = Array.isArray(row.blocking)
        ? row.blocking[0]
        : row.blocking;
      if (!blocking || blocking.deleted_at) return null;
      const blockingProject = Array.isArray(blocking.projects)
        ? blocking.projects[0]
        : blocking.projects;
      const related: DependencyRelatedTask = {
        dependencyId: row.id,
        taskId: blocking.id,
        title: blocking.title,
        status: blocking.status as DependencyRelatedTask["status"],
        projectKey: blockingProject?.key,
        number: blocking.number,
      };
      return related;
    })
    .filter((row): row is DependencyRelatedTask => row !== null);

  const blocks: DependencyRelatedTask[] = (blocksResult.data ?? [])
    .map((row) => {
      const blocked = Array.isArray(row.blocked)
        ? row.blocked[0]
        : row.blocked;
      if (!blocked || blocked.deleted_at) return null;
      const blockedProject = Array.isArray(blocked.projects)
        ? blocked.projects[0]
        : blocked.projects;
      const related: DependencyRelatedTask = {
        dependencyId: row.id,
        taskId: blocked.id,
        title: blocked.title,
        status: blocked.status as DependencyRelatedTask["status"],
        projectKey: blockedProject?.key,
        number: blocked.number,
      };
      return related;
    })
    .filter((row): row is DependencyRelatedTask => row !== null);

  const attachmentRows = attachmentsResult.data ?? [];

  // AS-106/AS-108: `fileUrl` here is the Storage object path (the same
  // value uploadAttachment inserts into the `attachments.file_url`
  // column), never a permanent public URL — this component's "Open"
  // action (AttachmentList.handleOpen) always mints its own fresh signed
  // URL on demand via getAttachmentSignedUrl before opening a file, so
  // this list-population fetch doesn't need to (and per AS-108's "don't
  // cache a stale one" intent, shouldn't) pre-mint one per row here.
  const attachments: TaskAttachment[] = attachmentRows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    fileName: row.file_name,
    fileUrl: row.file_url,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    mimeType: row.mime_type,
  }));

  return {
    ok: true,
    data: {
      task: {
        id: taskRow.id,
        title: taskRow.title,
        description: taskRow.description,
        // F171 (AS-307, AS-309): passed straight through as the Tiptap
        // `JSONContent` shape — the `Json` DB type is a structural
        // superset of `JSONContent`; RichTextRenderer/sanitiseDocument
        // validate/allow-list this at render time rather than trusting
        // the column's shape, since this is untrusted, previously-stored
        // content (AS-309 exists precisely because this can't be assumed
        // safe).
        descriptionJson: taskRow.description_json as
          | TaskDetailSheetTask["descriptionJson"]
          | undefined,
        status: taskRow.status as TaskDetailSheetTask["status"],
        // F222 (AS-410): see this function's select above.
        statusCategory: (
          Array.isArray(taskRow.project_statuses)
            ? taskRow.project_statuses[0]
            : taskRow.project_statuses
        )?.category,
        priority: taskRow.priority as TaskDetailSheetTask["priority"],
        assigneeId: taskRow.assignee_id,
        // F161 follow-through (AS-287, AS-288): see assigneesQuery above
        // — feeds the detail sheet's UserAvatarGroup header and its
        // multi-select assignee picker (both read/write this same set via
        // setTaskAssignees, never the deprecated single `assigneeId`
        // directly, once this field is populated).
        assigneeIds: (assigneesResult.data ?? []).map((row) => row.user_id),
        // F165 (AS-297): this task's current watcher set (is_watching:
        // true only, see watchersQuery above) plus whether the CALLING
        // user specifically is among them — the toggle button's
        // label/icon reflects `isWatching` for this signed-in caller,
        // never a generic "N people are watching" count (clarified
        // spec's own wording).
        watcherIds: (watchersResult.data ?? []).map((row) => row.user_id),
        isWatching: (watchersResult.data ?? []).some(
          (row) => row.user_id === user.id,
        ),
        dueDate: taskRow.due_date,
        // C2: whether this task is shared with the workspace's clients —
        // drives the detail sheet's share toggle. Selected on the same
        // query as everything else here, no second round trip.
        clientVisible: taskRow.client_visible ?? false,
        // F1 (docs/client-dashboard-features-plan.md): whether this task
        // is waiting on a client decision — same select, same reasoning.
        pendingClientApproval: taskRow.pending_client_approval ?? false,
        // F236 (AS-453): see this function's task select above.
        startDate: taskRow.start_date,
        // F005 (missions/20260903-portal, AS-014): see this function's
        // task select above — feeds the detail sheet's Page slug/order
        // inline fields directly, no local re-derivation.
        pageSlug: taskRow.page_slug,
        pageOrder: taskRow.page_order,
        // Free-text "why is this blocked" reason — see this function's
        // task select above.
        blockedReason: taskRow.blocked_reason ?? null,
        // F018 (TT-041): mirrors `tasks.billable` (F017, not null default
        // true) so the detail sheet's Billing toggle and the time-tracking
        // draft default both read the task's real current value, not a
        // hardcoded fallback. `?? true` only guards a caller/fixture whose
        // select predates F017.
        billable: taskRow.billable ?? true,
        // F118 (AS-066): the raw id, so the detail sheet's type editor
        // can call setTaskType with it directly — taskTypeName/
        // taskTypeSystemKey below remain display/gating-only, unchanged.
        taskTypeId: taskRow.task_type_id ?? null,
        taskTypeName:
          (Array.isArray(taskRow.task_types)
            ? taskRow.task_types[0]
            : taskRow.task_types
          )?.name ?? null,
        // F006c (missions/20260903-portal, AS-014): this task's type's
        // stable role, independent of its human-editable name — the
        // detail sheet gates the page fields on THIS, not taskTypeName
        // (see that gate's own doc comment in task-detail-sheet.tsx).
        taskTypeSystemKey:
          (Array.isArray(taskRow.task_types)
            ? taskRow.task_types[0]
            : taskRow.task_types
          )?.system_key ?? null,
        // F006c (missions/20260903-portal, AS-013): this task's current
        // phase assignment — see this function's task select above for
        // why this was never returned before this feature.
        phaseId: taskRow.phase_id,
        tags: taskRow.tags ?? [],
        // F146 (AS-258): see this function's task+project select above.
        number: taskRow.number,
        projectKey: projectRow?.key,
        // F167 follow-up: see this function's task select above — threads
        // the estimate through to TimeTracking via TaskDetailSheetTask.
        estimateMinutes: taskRow.estimate_minutes,
        // F150 (AS-263, AS-264): see this function's task select above —
        // `projectId` feeds the Subtasks section's add-subtask form,
        // `parentTaskId`/`parent` feed the "Subtask of ..." breadcrumb,
        // and `children` feeds the Subtasks section's list + completion
        // count. A subtask and its parent always share the SAME project
        // (F148's invariant), so both reuse this task's own
        // `projectRow?.key` for their task-key badges rather than a
        // second per-row join.
        projectId: taskRow.project_id,
        parentTaskId: taskRow.parent_task_id,
        parent: parentResult.data
          ? {
              id: parentResult.data.id,
              title: parentResult.data.title,
              projectKey: projectRow?.key,
              number: parentResult.data.number,
            }
          : null,
        // F179 (AS-317, AS-318, AS-319): the task's own recurrence rule
        // (null means no active rule) — feeds the RecurrenceEditor
        // picker's live summary/remove control below.
        recurrence: taskRow.recurrence as TaskDetailSheetTask["recurrence"],
        recurrenceParentId: taskRow.recurrence_parent_id,
        // F179 (AS-318): only populated when this task is itself a
        // GENERATED OCCURRENCE (see recurrenceSourceQuery above) — the
        // detail view's "View source task" link.
        recurrenceSource: recurrenceSourceResult.data
          ? {
              id: recurrenceSourceResult.data.id,
              title: recurrenceSourceResult.data.title,
              projectKey: projectRow?.key,
              number: recurrenceSourceResult.data.number,
            }
          : null,
        children: (childrenResult.data ?? []).map(
          (row): SubtaskListChildTask => ({
            id: row.id,
            title: row.title,
            status: row.status as SubtaskListChildTask["status"],
            // F222 (AS-410): see childrenQuery above. Same
            // array-or-object PostgREST embed normalization this file
            // uses everywhere else (e.g. taskRow.projects above).
            statusCategory: (
              Array.isArray(row.project_statuses)
                ? row.project_statuses[0]
                : row.project_statuses
            )?.category,
            assigneeId: row.assignee_id,
            projectKey: projectRow?.key,
            number: row.number,
          }),
        ),
        // F153 (AS-269 UI half): see checklistQuery above.
        checklistItems: (checklistResult.data ?? []).map(
          (row): ChecklistListItem => ({
            id: row.id,
            content: row.content,
            isChecked: row.is_checked,
            position: row.position,
          }),
        ),
        // F157 (AS-277): see blockedByQuery/blocksQuery above — both
        // directions, computed once here, never a per-section round trip
        // from components/task/dependencies.tsx.
        dependencies: { blockedBy, blocks },
      },
      comments: (commentsResult.data ?? []).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        userId: row.user_id,
        text: row.text,
        // F303 follow-up (D3/FU-1, AS-363): body_json/edited_at now
        // actually selected above — this is the read-path fix that makes
        // the "(edited)" marker and rich-text body survive a reload.
        bodyJson: row.body_json as TaskComment["bodyJson"],
        createdAt: row.created_at,
        editedAt: row.edited_at,
        // F303 follow-up (D3/FU-1, AS-365, AS-366): from the batched fetch
        // above, converted into CommentReactionSummary's exact shape.
        // Falls back to [] for a comment with no reactions, same
        // "always an array" convention as assigneeIds/watcherIds above.
        reactions: Array.from(
          reactionsByCommentId.get(row.id)?.entries() ?? [],
        ).map(([emoji, userIds]) => ({ emoji, userIds })),
      })),
      attachments,
      currentUserId: user.id,
      currentUserRole: membership.role,
    },
  };
}

