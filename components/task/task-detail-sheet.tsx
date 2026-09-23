"use client";

// F039: reusable task detail Sheet. Foundation/skeleton feature (no
// assertions assigned) — the goal is a clean, self-contained component
// ready to be opened by a real task card once one exists (F042's board,
// F053's list). There is no board/list rendering real task cards yet, so
// this file exports the Sheet plus its prop/data types and does not wire
// itself to any route.
//
// Pattern: smallest-possible-client-boundary, matching
// components/edit-project-dialog.tsx and components/member-role-select.tsx
// — the caller (a future Server Component page) fetches the task and its
// workspace's members and passes them down as props; this component only
// owns the interactive editing surface. `lib/queries/members.ts` (F017)
// already has the `getWorkspaceMembers` Server-only query used to build
// the `members` prop — it isn't called from here because this file must
// stay a Client Component and that query uses the Auth Admin client.
//
// Calls the F033-F038 Server Actions directly (editTask, assignTask,
// deleteTask) — Server Actions are safe to import and call from a Client
// Component. `status` currently has no Server Action support (editTask's
// `EditTaskUpdates` covers title/description/priority/dueDate only — see
// lib/validation/tasks.ts), so the status Select is rendered but disabled
// with an explanatory label rather than silently no-op persisting a value;
// this is a documented limitation for a future feature to lift once a
// changeTaskStatus (or equivalent) action exists, not an oversight.
//
// The four states called for by the clarified spec (loading, populated,
// empty, error) are all handled explicitly even though this component
// does not fetch its own data: `loading` and `error` are optional props a
// future data-fetching caller can drive; `task === null` while `open` is
// true is the empty state (should not normally happen, since a caller
// should only open the sheet once it has a task, but is handled rather
// than left to crash).
//
// ARCH-005 (audit 2026-09-13): the field-editing surface (title/
// description/status/priority/phase/type/assignees/dates/blocked reason/
// Page slug+order, with all its optimistic state) now lives in
// components/task/task-detail-fields.tsx, and the feature-panel
// composition block (Tags → Time tracking) in
// components/task/task-detail-sections.tsx — both extracted verbatim.
// This file keeps the Sheet chrome: open/close + Escape layering, the
// header's identity/visibility controls, the loading/error/empty states,
// the attachment dropzone wrapper, and the footer's template/duplicate/
// delete actions.

import { useRef, useTransition } from "react";
import { usePathname } from "next/navigation";
import {
  Copy,
  CornerUpLeft,
  Link as LinkIcon,
  Loader2,
  Repeat,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { showUndoToast } from "@/lib/toast/undo-toast";
import type { JSONContent } from "@/components/editor/rich-text-editor";
// F247 (AS-478): cooperates with F244's Escape-layer stack the same way
// NewTaskDialog (F244's own reference implementation) already does —
// registers itself as the topmost layer while open, so Escape closes only
// this Sheet (and, if something is layered ON TOP of it — e.g. a confirm
// dialog opened from inside — that layer instead) rather than the global
// keydown handler and Radix's own built-in Escape-close racing each other
// or, worse, an unrelated lower layer (e.g. ShortcutHelp open behind this
// Sheet) reacting instead because this Sheet never registered.
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";

import {
  deleteTask,
  restoreTask,
  duplicateTask,
  setTaskAssignees,
} from "@/lib/actions/tasks";
// F146 (AS-258): the single "KEY-NUMBER" formatter — see that file's doc
// comment for why every task-identity surface goes through it instead of
// re-concatenating projectKey/number locally.
import { formatTaskKey } from "@/lib/tasks/task-key";
import {
  canDeleteTask,
  canEditTask,
  canWrite,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
// F183 (AS-328 UI half): "Save as template" trigger, next to "Delete
// task" in this Sheet's footer.
import { SaveAsTemplateDialog } from "@/components/task/save-as-template-dialog";
import {
  useMembership,
  useProjectRole,
} from "@/components/auth/membership-provider";
import { type SubtaskListChildTask } from "@/components/task/subtask-list";
import { type ChecklistListItem } from "@/components/task/checklist";
import { type DependencyRelatedTask } from "@/components/task/dependencies";
import { type TaskComment } from "@/components/task/comment-list";
import {
  type AttachmentListHandle,
  type TaskAttachment,
} from "@/components/task/attachment-list";
import { AttachmentDropzone } from "@/components/task/attachment-dropzone";
import {
  type TimeEntry,
  type TimeTrackingActiveTimer,
} from "@/components/task/time-tracking";
import { Watchers } from "@/components/task/watchers";
import { ClientVisibilityToggle } from "@/components/task/client-visibility-toggle";
import { PendingApprovalToggle } from "@/components/task/pending-approval-toggle";
// ARCH-005: the extracted field-editing surface and the feature-panel
// composition block — see this file's top doc comment.
import { TaskDetailFields } from "@/components/task/task-detail-fields";
import { TaskDetailSections } from "@/components/task/task-detail-sections";
// F008 (missions/20260903-portal, AS-019): the richer "raise a real
// approval request" path, shown beside PendingApprovalToggle rather than
// replacing it — that toggle stays the quick "waiting on client" flag,
// this dialog is the one that actually creates an approval_requests row
// with a decision type, a due date and a message.
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import Link from "next/link";
import { Eye } from "lucide-react";
import type { RecurrenceRule } from "@/lib/recurrence/next-date";
// F122 (AS-214): "assignee pickers" includes this Sheet's own assignee
// control.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
// F161 (AS-287, AS-288): stacked avatar group for this task's full
// assignee set, header + trigger.
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type TaskDetailSheetTask = {
  id: string;
  title: string;
  description: string | null;
  /** F171 (AS-307, AS-309): the same description, stored as a Tiptap JSON
   * document (F170's `tasks.description_json`, always kept in sync with
   * `description` by a DB trigger — see F170's handoff). Rendered
   * read-only through RichTextRenderer's allow-listed schema below,
   * NEVER via the raw-HTML-injection prop React provides for bypassing
   * its escaping. Optional so a caller/fixture
   * that hasn't been updated yet still renders (falls back to showing
   * nothing extra beyond the plain-text description already shown by the
   * editable Textarea). Untrusted, previously-stored content — treated
   * as hostile input at render time, not assumed safe because it came
   * from our own DB. */
  descriptionJson?: JSONContent | null;
  status: "todo" | "in_progress" | "in_review" | "done";
  // F222 (AS-410): this task's own board column category, when the
  // caller has it — feeds isOverdue's category-aware check below.
  // Optional/undefined falls back to isOverdue's own literal-status-text
  // rule, same "safe default" convention as every other optional field
  // on this type.
  statusCategory?: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  assigneeId: string | null;
  /** F161 (AS-287, AS-288): this task's full current assignee set,
   * oldest-first, from getTaskDetail's own `task_assignees` fetch
   * (lib/actions/tasks.ts) — no second round trip. Optional/defaults to
   * [] so a caller that hasn't been updated yet (existing tests/
   * fixtures) still renders, falling back to the single legacy
   * `assigneeId` above for the header avatar, same "safe default"
   * convention as every other optional field on this type. This is the
   * array the multi-select picker below reads from and writes to via
   * `setTaskAssignees` — `assigneeId` stays read-only display/fallback
   * once this is populated. */
  assigneeIds?: string[];
  dueDate: string | null;
  /** C2: whether this task is shared with the workspace's clients. Drives
   * the share toggle in the header; false/undefined both mean internal. */
  clientVisible?: boolean;
  /** F1 (docs/client-dashboard-features-plan.md): whether this task is
   * waiting on a client decision. Only meaningful when clientVisible is
   * true; false/undefined both mean "not waiting". */
  pendingClientApproval?: boolean;
  /** F236 (AS-453): this task's start date, sibling to `dueDate` above —
   * same "plain YYYY-MM-DD string or null" shape, same source
   * (getTaskDetail's own task select, no second round trip). */
  startDate: string | null;
  /** AS-065: may be empty — every task has a tag list, never null. */
  tags: string[];
  /** F166/F167 (AS-300, AS-301, AS-302): this task's `estimate_minutes`,
   * threaded straight through to TimeTracking's estimate row/progress
   * bar/over-estimate badge below. Optional/null both mean "no estimate
   * set" — TimeTracking's own "safe default" convention (see that
   * component's `estimateMinutes` prop doc comment) handles the AS-302
   * empty state; this Sheet does no computation of its own. */
  estimateMinutes?: number | null;
  /** F146 (AS-258): this task's owning project's key (e.g. "PM") and its
   * own per-project sequential number (e.g. 142), combined by
   * formatTaskKey into "PM-142" for the header's click-to-copy badge
   * below. Both come from getTaskDetail's existing task+project fetch
   * (lib/actions/tasks.ts) — no second round trip. Optional so a caller
   * that hasn't been updated (existing tests/fixtures) still renders
   * without the badge instead of crashing, matching this type's other
   * optional-by-convention fields elsewhere in this file. */
  projectKey?: string;
  number?: number;
  /** F150 (AS-263, AS-264): this task's own project id — needed by the
   * Subtasks section's inline add-subtask form to call createTask
   * without a second round trip to look it up. Optional so a caller that
   * hasn't been updated (existing tests/fixtures) still renders; the
   * add-subtask input is simply disabled when absent (SubtaskList's own
   * "safe default" convention). */
  projectId?: string;
  /** F150 (AS-263): non-null only when THIS task is itself a subtask —
   * the id of its parent task. Drives whether the "Subtask of ..."
   * breadcrumb renders at all. null/undefined both mean "top-level task,
   * no breadcrumb". */
  parentTaskId?: string | null;
  /** F150 (AS-263): just enough of the parent task to render and open the
   * breadcrumb link — populated by getTaskDetail's existing task+project
   * fetch (one extra lookup only when parentTaskId is set), never a
   * per-render fetch from this Client Component. */
  parent?: {
    id: string;
    title: string;
    projectKey?: string;
    number?: number;
  } | null;
  /** F150 (AS-264): this task's own children (subtasks) — just enough of
   * each to render a status chip + assignee avatar in the Subtasks
   * section. Fetched by getTaskDetail's existing query (one extra query,
   * not a per-child round trip). Optional/defaults to [] via
   * SubtaskList's own prop default so a caller that hasn't been updated
   * yet still renders an empty (not crashing) Subtasks section. */
  children?: SubtaskListChildTask[];
  /** F153 (AS-269 UI half): this task's own checklist items, from
   * getTaskDetail's own query (lib/actions/tasks.ts) — same "fetched
   * once with the task, no per-section round trip" convention as
   * `children` immediately above. Optional/defaults to [] via
   * Checklist's own rendering below so a caller that hasn't been updated
   * yet (existing tests/fixtures) still renders rather than crashing,
   * same "safe default" convention as every other optional field on this
   * type. */
  checklistItems?: ChecklistListItem[];
  /** F157 (AS-277): this task's own dependency rows, in BOTH directions,
   * from getTaskDetail's own query (lib/actions/tasks.ts) — same
   * "fetched once with the task, no per-section round trip" convention
   * as `children`/`checklistItems` above. Optional/defaults to empty
   * arrays via Dependencies' own rendering below so a caller that hasn't
   * been updated yet (existing tests/fixtures) still renders rather than
   * crashing, same "safe default" convention as every other optional
   * field on this type. */
  dependencies?: {
    blockedBy: DependencyRelatedTask[];
    blocks: DependencyRelatedTask[];
  };
  /** F165 (AS-297): this task's current watcher set (`is_watching: true`
   * only), from getTaskDetail's own `task_watchers` fetch — same "fetched
   * once with the task, no per-section round trip" convention as
   * `children`/`checklistItems`/`dependencies` above. Optional/defaults to
   * [] via the Watchers component's own rendering below so a caller that
   * hasn't been updated yet (existing tests/fixtures) still renders
   * rather than crashing. */
  watcherIds?: string[];
  /** F165 (AS-297): whether the SIGNED-IN caller specifically is
   * currently watching — drives the toggle button's label/icon, never a
   * generic count (clarified spec). Optional/defaults to false for the
   * same "safe default" reason as `watcherIds` above. */
  isWatching?: boolean;
  /** F179 (AS-317, AS-318, AS-319): this task's own recurrence rule, or
   * null/undefined for no active rule. Feeds RecurrenceEditor's picker/
   * live summary/remove control below — see lib/recurrence/next-date.ts's
   * `RecurrenceRule` for the exact shape (frozen by F175's handoff).
   * Optional so a caller that hasn't been updated yet (existing tests/
   * fixtures) still renders, same "safe default" convention as every
   * other optional field on this type. */
  recurrence?: RecurrenceRule | null;
  /** F179 (AS-318): non-null only when THIS task is itself a GENERATED
   * OCCURRENCE (F177's `recurrence_parent_id`, which always points at the
   * series ROOT — see that feature's handoff). Drives whether the
   * "View source task" link renders. */
  recurrenceParentId?: string | null;
  /** F179 (AS-318): just enough of the recurrence source (series root)
   * task to render and open the link — populated by getTaskDetail's
   * existing task+project fetch (one extra lookup only when
   * `recurrenceParentId` is set), never a per-render fetch from this
   * Client Component. Mirrors `parent`'s own shape/convention above. */
  recurrenceSource?: {
    id: string;
    title: string;
    projectKey?: string;
    number?: number;
  } | null;
  /** F002 (missions/20260903-portal, AS-013): this task's current phase,
   * or null/undefined for "no phase assigned". Optional so a caller that
   * hasn't been updated yet (existing tests/fixtures) still renders, same
   * "safe default" convention as every other optional field on this
   * type. */
  phaseId?: string | null;
  /** F005 (missions/20260903-portal, AS-014): this task's own workspace
   * task type NAME (e.g. "Page"). Display/logging only — see
   * `taskTypeSystemKey` below for what actually gates the Page slug/
   * order fields. Optional/null both mean "no type set" — same "safe
   * default" convention as every other optional field on this type. */
  taskTypeName?: string | null;
  /** F118 (AS-066): this task's own type row id — write path for the
   * type editor below (`setTaskType`, lib/actions/task-types.ts).
   * Optional/null both mean "not loaded/known" — same "safe default"
   * convention as every other optional field on this type; a caller
   * that hasn't been updated yet (existing tests/fixtures) simply never
   * shows the type editor as populated. */
  taskTypeId?: string | null;
  /** F006c (missions/20260903-portal, AS-014): this task's type's stable
   * `system_key` (supabase/migrations/20260912010000_task_type_system_key.sql),
   * independent of its human-editable name — THIS, not `taskTypeName`,
   * is what decides whether the Page slug/order fields render (see that
   * gate below). A workspace whose page type is named "Sida" or renamed
   * later still shows/orders these fields correctly, because the type's
   * ROLE, not its label, is what's checked. Optional/null both mean "no
   * portal role set" — same "safe default" convention as every other
   * optional field on this type; a caller that hasn't been updated yet
   * (existing tests/fixtures) simply never shows the two page fields. */
  taskTypeSystemKey?: string | null;
  /** F005 (AS-014): the portal Pages view's own slug for this task, or
   * null/undefined for "not set yet". Editable only when
   * `taskTypeSystemKey` is "page" — see the Page slug field below. */
  pageSlug?: string | null;
  /** F005 (AS-014): the team's own manual ordering for this task in the
   * portal Pages view — the Pages view sorts by this (nulls last), never
   * by creation date. Same visibility gate as `pageSlug` above. */
  pageOrder?: number | null;
  /** Free-text "why is this blocked" reason (`tasks.blocked_reason`),
   * shown/editable only while this task's own `status` case-insensitively
   * equals "blocked". Optional/null both mean "no reason recorded" — same
   * "safe default" convention as every other optional field on this
   * type. */
  blockedReason?: string | null;
};

function memberLabel(member: TaskDetailSheetMember): string {
  return member.name || member.email || member.userId;
}

export type TaskDetailSheetMember = {
  userId: string;
  email: string | null;
  name: string | null;
  /** F122 (AS-214): optional so existing callers (tests, callers not yet
   * updated) don't have to pass it — a missing avatarUrl just means the
   * initials fallback renders instead of an image. */
  avatarUrl?: string | null;
  /** Out-of-office status note: optional for the same reason avatarUrl
   * is — existing callers not yet updated simply render no tooltip. */
  statusNote?: string | null;
  statusNoteUntil?: string | null;
};

export function TaskDetailSheet({
  task,
  members,
  attachments = [],
  timeEntries = [],
  activeTimer = null,
  open,
  onOpenChange,
  loading = false,
  error = null,
  onRetry,
  onDeleted,
  currentUserId,
  currentUserRole,
  timezone,
  onOpenTask,
  statusOptions,
}: {
  /** The task to display, or null (empty state) if none is loaded. */
  task: TaskDetailSheetTask | null;
  /** Workspace members eligible as assignees (from getWorkspaceMembers). */
  members: TaskDetailSheetMember[];
  /** F060: task's comments (from lib/queries/comments.ts's getTaskComments),
   * ideally already oldest-first. Defaults to empty — a caller that hasn't
   * been updated to fetch comments yet still renders a valid empty state
   * rather than crashing. */
  comments?: TaskComment[];
  /** F066: task's attachments (from a future getTaskAttachments query).
   * Defaults to empty — a caller that hasn't been updated yet still
   * renders a valid empty state rather than crashing. */
  attachments?: TaskAttachment[];
  /** F113 (AS-171): task's time entries (a future getTaskTimeEntries query
   * would fetch these). Defaults to empty — a caller that hasn't been
   * updated yet still renders a valid empty state rather than crashing. */
  timeEntries?: TimeEntry[];
  /** F113: the viewer's own active timer, if any, from F111's
   * getActiveTimer. Defaults to null (no active timer) when the caller
   * hasn't fetched it yet. */
  activeTimer?: TimeTrackingActiveTimer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Drives the loading skeleton when a future caller is still fetching. */
  loading?: boolean;
  /** Drives the inline error state when a future caller's fetch failed. */
  error?: string | null;
  onRetry?: () => void;
  /** Called after a successful delete so the caller can close/refresh. */
  onDeleted?: (taskId: string) => void;
  /** F061: the viewer's own user id, used by CommentList to show a delete
   * affordance on their own comments (AS-098). Undefined (caller hasn't
   * been updated yet) hides the delete affordance entirely — a safe
   * default, since the server independently re-checks authorization
   * regardless (AS-099). */
  currentUserId?: string;
  /** F061: the viewer's active role in this task's workspace, used by
   * CommentList to show a delete affordance on *any* comment for
   * admin/owner (AS-100). */
  /** F128 (AS-216): widened to the full `WorkspaceRole` so the write
   * controls this Sheet composes (CommentList/AttachmentList/TimeTracking)
   * can be disabled for a read-only caller. */
  currentUserRole?: WorkspaceRole;
  /** F124/F275 (AS-207): the viewer's IANA timezone, resolved once per
   * request by the caller's Server Component page (board/page.tsx,
   * list/page.tsx — via lib/queries/profile.ts's getCurrentUserTimezone)
   * and passed through here, never fetched by this Client Component.
   * REQUIRED since F275 — unlike `currentUserId`/`activeTimer` above,
   * this one drives the overdue badge next to the due-date field, and a
   * silent "UTC" default is exactly the class of bug M10 scrutiny found
   * (AS-207): a page that forgets to pass it renders every task as if
   * the viewer were in UTC with no type error. */
  timezone: string;
  /** F150 (AS-263, AS-264): opens a different task (a subtask row, or
   * this task's own parent via the breadcrumb below) in this same Sheet.
   * Undefined hides no UI — the breadcrumb/subtask rows still render,
   * they just aren't clickable (SubtaskList's own optional-onOpenTask
   * convention) — matching every other optional-callback field's "safe
   * default" in this file. Real callers (Board, TaskListTable) wire this
   * to the SAME `useTaskDetailSheet().openTask` that already opens a
   * task from a card/row click. */
  onOpenTask?: (taskId: string) => void;
  /** F304 (AS-374 follow-up): when a notification's deep-link carries a
   * `?commentId=`, this is that id, threaded straight through to
   * CommentList so it can scroll to and briefly highlight the matching
   * comment once its own list has rendered. Undefined/null for every
   * other open path (a plain card click, a `?taskId=`-only deep-link) —
   * CommentList's default behavior (no scroll/highlight) is unchanged. */
  highlightCommentId?: string | null;
  /** F1 (status-sitemap-audit mission, AS-4): this task's own project's
   * real `project_statuses` columns (lib/queries/statuses.ts's
   * getProjectColumns), passed straight through to <TaskDetailFields>'s
   * status picker — same data shape/source Board's `columns` prop and the
   * List view's `statusOptions` prop already use. Undefined (a caller
   * that hasn't been updated, e.g. an existing test) falls back to
   * TaskDetailFields's own legacy STATUS_LABELS-derived default so this
   * Sheet still renders rather than crashing. */
  statusOptions?: {
    value: string;
    label: string;
    color: string;
    category?: string | null;
    displayGroup?: string | null;
  }[];
}) {
  // F246 (AS-473): derives the current workspace slug from the URL
  // itself (`/w/{slug}/...`, this sheet's caller is always mounted
  // somewhere under that segment — board.tsx, list, calendar) rather than
  // threading a new `workspaceSlug` prop through every one of this
  // component's existing callers. `pathname` is always a real, non-null
  // string in the browser; only `null` in a context where this component
  // isn't mounted under `/w/[workspaceSlug]/...` at all, which doesn't
  // happen today.
  const pathname = usePathname();
  // F258 (AS-501, AS-503): AttachmentDropzone's onFilesDropped calls
  // straight into AttachmentList's imperative handle so a drag-drop upload
  // funnels through the exact same Server Action + local-state path the
  // file-picker input already uses — no parallel upload implementation.
  const attachmentListRef = useRef<AttachmentListHandle>(null);
  // F247 (AS-478): registered for as long as the Sheet is open — see the
  // import comment above.
  useEscapeLayer(open, () => onOpenChange(false));
  const [isAssigning, startAssignTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  // Duplicate action: reuses the existing F180 duplicateTask Server Action
  // (lib/actions/tasks.ts) — copies title (-> "Copy of <title>"),
  // description, priority, task_type, checklist items and assignees into a
  // NEW task in the SAME project. This Sheet only wires the button + result
  // handling; no new server action was written since duplicateTask already
  // implements exactly this.
  const [isDuplicating, startDuplicateTransition] = useTransition();

  function handleDuplicate() {
    if (!task) return;
    const sourceTaskId = task.id;
    startDuplicateTransition(async () => {
      const result = await duplicateTask(sourceTaskId);
      if (result.ok) {
        toast.success("Task duplicated.");
        onOpenTask?.(result.data.id);
      } else {
        toast.error(result.error);
      }
    });
  }

  // F135 (AS-231): lib/auth/permissions.ts (F127) is the single source of
  // truth for whether this caller may edit/delete this task — never
  // re-derived from `currentUserRole` inline. `projectRole` comes from the
  // membership context (see membership-provider.tsx's own doc comment),
  // not a second fetch. `currentUserRole` undefined (a caller that hasn't
  // been updated to pass it, e.g. an existing test) is treated as
  // permissive, matching every other optional-role prop's "safe default"
  // convention already established by CommentList/TimeTracking/
  // AttachmentList in this same codebase.
  const projectRole = useProjectRole(task?.projectId);
  // C2: hide the share-with-client toggle entirely in workspaces that have
  // no client — see MembershipProvider's own `hasClient` doc comment.
  const workspaceHasClient = useMembership()?.hasClient ?? false;
  const canEdit = currentUserRole
    ? canEditTask({ role: currentUserRole, projectRole })
    : true;
  // Deliberately conservative: this codebase has no task-creator/owner
  // tracking yet (no `createdBy`/`created_by` column — see this feature's
  // handoff Out-of-scope section), so `resourceOwnerId`/`callerId` are
  // never passed here and canDeleteTask's ownership branch always
  // evaluates to false for a plain "member" without a project-lead role.
  // That's the safe direction for AS-231 (a control that COULD have
  // succeeded staying hidden is not a violation; a control that WILL fail
  // being shown is) — it just means a task's own creator can't yet delete
  // it themselves unless they're also owner/admin/lead, which the handoff
  // flags as a known gap for a future feature to lift once ownership is
  // tracked.
  const canDelete = currentUserRole
    ? canDeleteTask({ role: currentUserRole, projectRole })
    : true;
  const editDisabledTitle = canEdit
    ? undefined
    : "You don't have permission to edit this task.";
  // F183 (AS-328 UI half): saving a template is a write, gated by the same
  // generic canWrite predicate saveTaskAsTemplate re-checks server-side
  // (viewers are read-only). `undefined` role treated as permissive,
  // matching this Sheet's own canEdit/canDelete and NewTaskDialog's
  // convention above.
  const canSaveTemplate = currentUserRole
    ? canWrite({ role: currentUserRole })
    : true;
  const saveTemplateDisabledTitle = canSaveTemplate
    ? undefined
    : "You don't have permission to save templates.";

  // F161 (AS-287, AS-288): replaces the old single-value handleAssigneeChange
  // — the picker below toggles ONE user id in/out of the task's full
  // assignee set and sends the whole resulting set through
  // `setTaskAssignees` (F160), the same shared write path `assignTask`
  // itself now delegates to (lib/actions/tasks.ts's setTaskAssigneesCore
  // doc comment). Current set is read from `task.assigneeIds` when
  // populated, falling back to the single legacy `assigneeId` for a
  // caller/task that predates this feature so toggling still starts from
  // the right baseline instead of silently dropping an existing assignee.
  function handleAssigneesToggle(userId: string) {
    if (!task) return;
    const current =
      task.assigneeIds && task.assigneeIds.length > 0
        ? task.assigneeIds
        : task.assigneeId
          ? [task.assigneeId]
          : [];
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    startAssignTransition(async () => {
      const result = await setTaskAssignees(task.id, next);
      if (result.ok) {
        toast.success(
          next.length > 0 ? "Assignees updated." : "Task unassigned.",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    const deletedTaskId = task.id;
    startDeleteTransition(async () => {
      const result = await deleteTask(deletedTaskId);
      if (result.ok) {
        onOpenChange(false);
        onDeleted?.(deletedTaskId);
        // F190 (AS-345): Undo restores the same task without visiting
        // trash. restoreTask's own revalidatePath (list views) and the
        // board's realtime subscription (board.tsx's reconcileTask, which
        // re-inserts a task the instant its deleted_at UPDATE clears) both
        // already pick this restore up — no extra client-side plumbing is
        // needed here beyond calling the action.
        showUndoToast({
          message: "Task deleted.",
          onUndo: async () => {
            const restoreResult = await restoreTask(deletedTaskId);
            if (restoreResult.ok) {
              toast.success("Task restored.");
            } else {
              toast.error(restoreResult.error);
            }
          },
        });
      } else {
        toast.error(result.error);
      }
    });
  }

  // F146 (AS-258): null when either half is missing (e.g. a caller that
  // hasn't been updated yet) — formatTaskKey's contract is "null means
  // don't render the badge," never a malformed partial string.
  const taskKey = task ? formatTaskKey(task.projectKey, task.number) : null;

  function handleCopyKey() {
    if (!taskKey) return;
    navigator.clipboard
      .writeText(taskKey)
      .then(() => {
        toast.success(`Copied ${taskKey} to clipboard.`);
      })
      .catch(() => {
        toast.error("Couldn't copy to clipboard. Please try again.");
      });
  }

  // F246 (AS-473): copies this task's CANONICAL, key-based deep-link URL
  // (`/w/{slug}/t/{taskKey}`, resolved server-side by
  // app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx) — distinct
  // from `handleCopyKey` above, which only copies the bare "PM-142" text.
  // `workspaceSlug` is read from the current pathname's own `/w/{slug}/`
  // segment (see this component's `pathname` doc comment above); if that
  // segment can't be found (shouldn't happen — this sheet only ever
  // mounts under `/w/[workspaceSlug]/...`) the control silently does not
  // render below rather than copying a broken link.
  const workspaceSlugMatch = pathname?.match(/^\/w\/([^/]+)\//);
  const workspaceSlug = workspaceSlugMatch?.[1];
  const canonicalTaskPath =
    workspaceSlug && taskKey
      ? `/w/${workspaceSlug}/t/${taskKey}`
      : null;

  function handleCopyLink() {
    if (!canonicalTaskPath) return;
    const url = `${window.location.origin}${canonicalTaskPath}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        toast.success("Link copied — anyone with access to this task can open it.");
      })
      .catch(() => {
        toast.error("Couldn't copy the link. Please try again.");
      });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-describedby={undefined}
        // F265 (AS-516): full-screen below the `sm` breakpoint (this
        // codebase's established mobile/tablet breakpoint convention --
        // see F264's board carousel). The base Sheet (components/ui/
        // sheet.tsx) sets `data-[side=right]:w-3/4`/`data-[side=left]:
        // w-3/4` with NO breakpoint qualifier, so it's a plain,
        // non-conditional class -- a bare `w-full` here loses the CSS
        // cascade tie (equal specificity: one class + one attribute
        // selector each, `w-3/4`'s rule has no media-query wrapper so it
        // sorts before any responsive-variant rule in Tailwind v4's
        // generated stylesheet) exactly like this same file's pre-existing
        // `data-[side=right]:sm:max-w-2xl` override already had to work
        // around for `max-w`. `max-sm:data-[side=right]:w-full`/
        // `max-sm:data-[side=left]:w-full` (plus `max-w-none` to cancel
        // the `sm:max-w-2xl` override above, which doesn't apply below
        // `sm` anyway but is cancelled explicitly for clarity) match that
        // same "data-attr variant, so it wins the specificity tie AND
        // compiles into a media-query block that sorts after the
        // unconditional base rule" pattern -- this is NOT `!w-full`
        // (Tailwind's `!important` escape hatch); it's the same
        // data-attribute-qualified technique already proven to work in
        // this exact file, so no new CSS-override mechanism is
        // introduced. `max-sm:h-svh max-sm:max-h-svh` and `max-sm:rounded-none
        // max-sm:border-0` make it genuinely full-screen (not just
        // full-width) -- `h-full`/`inset-y-0` from the base already cover
        // full height, `rounded-none`/`border-0` remove the "floating
        // sheet" look at that width so it reads as a full page, not a
        // sheet with a visible seam.
        className="w-full sm:max-w-[1100px] data-[side=right]:sm:max-w-[1100px] data-[side=left]:sm:max-w-[1100px] max-sm:data-[side=right]:w-full max-sm:data-[side=right]:max-w-none max-sm:data-[side=left]:w-full max-sm:data-[side=left]:max-w-none max-sm:h-svh max-sm:max-h-svh max-sm:rounded-none max-sm:border-0"
      >
        {loading ? (
          <div className="flex flex-col gap-4 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Loading task…</SheetTitle>
            </SheetHeader>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : error ? (
          <div className="flex flex-col gap-4 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>Couldn&apos;t load task</SheetTitle>
              <SheetDescription>{error}</SheetDescription>
            </SheetHeader>
            {onRetry && (
              <Button variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        ) : !task ? (
          <div className="flex flex-col gap-2 p-4">
            <SheetHeader className="p-0">
              <SheetTitle>No task selected</SheetTitle>
              <SheetDescription>
                Select a task to see its details here.
              </SheetDescription>
            </SheetHeader>
          </div>
        ) : (
          <AttachmentDropzone
            disabled={
              currentUserRole ? !canWrite({ role: currentUserRole }) : false
            }
            onFilesDropped={(files) =>
              attachmentListRef.current?.uploadFiles(files)
            }
          >
            <SheetHeader
              // F265 (AS-516): sticky header on phone widths -- the task
              // key stays visible (and reachable to copy/close) while the
              // long, now full-screen, single-column content below
              // scrolls underneath it. `bg-popover` (matching
              // SheetContent's own background token) prevents scrolled
              // content showing through; `border-b` gives it a visible
              // edge once something has scrolled under it (a plain
              // `sticky` header floating with no visual separation from
              // the content beneath is easy to miss).
              className="max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:border-b max-sm:bg-popover"
            >
              {/* F513 (design cleanup): every badge/link/toggle below this
                  point used to be a direct flex-col child of SheetHeader
                  (`gap-0.5`), which stacked up to ~9 small chip-like
                  controls in a single narrow column — key badge, copy
                  link, parent/recurrence breadcrumbs, share/approval
                  toggles, "View as client", watchers — with almost no
                  visual grouping between unrelated concerns. They're all
                  inline, self-contained controls (Button/plain <button>
                  roots), so wrapping them in one `flex-wrap` row lets
                  related controls sit side by side and wrap naturally at
                  narrow widths instead of forcing a tall, awkward single
                  column above the title on every task. */}
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
              {taskKey && (
                // F146 (AS-258): click-to-copy task key. A plain <button>
                // rather than a div/span with an onClick — native buttons
                // are keyboard-operable by default (Tab to focus, Enter/
                // Space to activate) with no extra key handling needed,
                // and the sonner toast below is the "feedback" the
                // clarified spec's failure-handling answer calls for
                // (success and failure both surface as a toast, matching
                // this component's saveField/handleDelete convention).
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label={`Copy task key ${taskKey} to clipboard`}
                >
                  <Copy className="size-3" aria-hidden="true" />
                  {taskKey}
                </button>
              )}
              {canonicalTaskPath && (
                // F246 (AS-473): the deep-link "copy link" control — same
                // plain-button, keyboard-operable-by-default pattern as
                // the click-to-copy key badge immediately above, and the
                // same copy-to-clipboard + sonner-toast feedback
                // convention as ViewSwitcher's own `copyLink`
                // (components/views/view-switcher.tsx).
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label="Copy link to this task"
                >
                  <LinkIcon className="size-3" aria-hidden="true" />
                  Copy link
                </button>
              )}
              {/* F150 (AS-263): a child task shows a link back to its
                  parent. Rendered only when this task actually has a
                  resolved parent (getTaskDetail only populates it when
                  parentTaskId is set AND the parent is still live) — a
                  top-level task, or a child whose parent was deleted
                  independently, renders no breadcrumb at all rather than
                  a dead link. */}
              {task.parent && (
                <button
                  type="button"
                  onClick={() => onOpenTask?.(task.parent!.id)}
                  disabled={!onOpenTask}
                  className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-70"
                  aria-label={`Open parent task ${
                    formatTaskKey(task.parent.projectKey, task.parent.number) ??
                    task.parent.title
                  }`}
                >
                  <CornerUpLeft className="size-3" aria-hidden="true" />
                  Subtask of{" "}
                  {formatTaskKey(task.parent.projectKey, task.parent.number) ??
                    task.parent.title}
                </button>
              )}
              {/* F179 (AS-318): a GENERATED OCCURRENCE (recurrenceParentId
                  set) links back to its source/root task — mirrors the
                  "Subtask of ..." breadcrumb immediately above, just with
                  Repeat's icon and "Generated from ..." wording so the two
                  relationships (parent/child vs. recurrence
                  source/occurrence) never look identical. Rendered only
                  when getTaskDetail actually resolved the source row
                  (still live, not soft-deleted) — same "no dead link"
                  convention as the parent breadcrumb. */}
              {task.recurrenceSource && (
                <button
                  type="button"
                  onClick={() => onOpenTask?.(task.recurrenceSource!.id)}
                  disabled={!onOpenTask}
                  className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-70"
                  aria-label={`Open source task ${
                    formatTaskKey(
                      task.recurrenceSource.projectKey,
                      task.recurrenceSource.number,
                    ) ?? task.recurrenceSource.title
                  }`}
                >
                  <Repeat className="size-3" aria-hidden="true" />
                  Generated from{" "}
                  {formatTaskKey(
                    task.recurrenceSource.projectKey,
                    task.recurrenceSource.number,
                  ) ?? task.recurrenceSource.title}
                </button>
              )}
              <SheetTitle className="sr-only">{task?.title ?? "Task details"}</SheetTitle>
              <SheetDescription className="sr-only">
                View and edit this task&apos;s title, description, status,
                priority, assignee, and due date.
              </SheetDescription>
              {/* F165 (AS-297): watch/unwatch toggle + watcher avatar
                  group. Placed in the header, below the title, rather
                  than inside the metadata grid the assignee picker lives
                  in — visually subordinate to assignees, per the
                  clarified spec's own ambiguity-resolution note. */}
              {/* C2: the share-with-client toggle, alongside the watch
                  toggle rather than in the metadata grid — both are
                  "who is looking at this" controls, not task fields.
                  Rendered only when the workspace has at least one
                  client, so teams that never use the portal never see
                  an affordance implying an audience they don't have. */}
              {workspaceHasClient && (
                <ClientVisibilityToggle
                  taskId={task.id}
                  clientVisible={task.clientVisible ?? false}
                  disabled={!canEdit}
                />
              )}
              {/* F1: asking for a decision only makes sense once the task
                  is actually visible to the client — shown alongside the
                  share toggle rather than gated behind it, so the team
                  sees at a glance that sharing is a prerequisite. */}
              {workspaceHasClient && task.clientVisible && (
                <PendingApprovalToggle
                  taskId={task.id}
                  pendingClientApproval={task.pendingClientApproval ?? false}
                  disabled={!canEdit}
                />
              )}
              {/* F008 (AS-019, AS-020): only offered once the task is
                  actually client-visible — mirrors PendingApprovalToggle's
                  own gate immediately above. The server action re-checks
                  this independently (AS-020's real enforcement point), so
                  this gate is a UX nicety, not the security boundary. */}
              {workspaceHasClient && task.clientVisible && task.projectId && canEdit && (
                <RequestApprovalDialog
                  projectId={task.projectId}
                  subject={{
                    subjectType: "task",
                    subjectId: task.id,
                    defaultTitle: task.title,
                    defaultMessage: task.description,
                    defaultDecisionType: task.taskTypeSystemKey === "page" ? "brand" : "content",
                  }}
                />
              )}
              {/* F024 (missions/20260903-portal, AS-052): "View as client" --
                  the one-click path into client-preview mode, deep-linked
                  at this exact task. Owner/admin only (mirrors the
                  authz gate `startClientPreview` re-checks server-side);
                  requires the task to already be client-visible, since
                  previewing a task the client can't see anyway would
                  just land on the project chooser with nothing to show.
                  The actual client selection happens on the destination
                  page (there may be more than one client on this
                  project) -- this link is the shortcut into that picker
                  with project/task already filled in, not a bypass of
                  it. */}
              {workspaceHasClient &&
                task.clientVisible &&
                task.projectId &&
                workspaceSlug &&
                (currentUserRole === "owner" || currentUserRole === "admin") && (
                  <Link
                    href={`/w/${workspaceSlug}/preview-as-client?projectId=${task.projectId}&taskId=${task.id}`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                    View as client
                  </Link>
                )}
              <Watchers
                taskId={task.id}
                watcherIds={task.watcherIds ?? []}
                isWatching={task.isWatching ?? false}
                members={members.map((member) => ({
                  userId: member.userId,
                  name: member.name,
                  email: member.email,
                  avatarUrl: member.avatarUrl,
                }))}
                currentUserId={currentUserId}
              />
              </div>
            </SheetHeader>
            {/* F513 (design cleanup): `py-6` closes the gap that used to
                leave the first field (Title) touching the header's own
                bottom edge, and the last section (Time tracking) touching
                the footer's top edge, with zero breathing room on either
                side — every other boundary in this Sheet (header/footer
                themselves) already uses `p-4`; scrollable content deserves
                at least as much, and slightly more since it's the dominant
                area. */}
            {/* F009 (TT-020, TT-022): two-column shell at lg+ — main
                editing surface (title/fields/sections) on the left,
                a placeholder right column (populated by F010) on the
                right. Below lg it collapses to a single stacked column
                (grid-cols-1 default, lg:grid-cols-[...] only applies at
                the lg breakpoint) with no horizontal scroll — the grid
                itself never sets a min-width wider than its container,
                so narrow viewports simply stack the two "columns"
                vertically instead of clipping/scrolling. */}
            <div className="grid grid-cols-1 gap-4 overflow-y-auto p-6 pt-4 lg:grid-cols-[1.6fr_1fr] lg:gap-4 lg:p-8 lg:pt-8">
              <div className="flex flex-col gap-6">
              <TaskDetailFields
                task={task}
                members={members}
                open={open}
                canEdit={canEdit}
                editDisabledTitle={editDisabledTitle}
                timezone={timezone}
                statusOptions={statusOptions}
                assigneeField={
                  /* UX audit (Nalaz 2): Assignees shared the same
                     1-column width as every other field in the metadata
                     5-column grid, so a full name (e.g. a long
                     first+last name) truncated aggressively even though
                     the Sheet itself (`sm:max-w-2xl`) has plenty of
                     spare width. col-span-2 gives it roughly double the
                     room without touching any other field's width. */
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <Label id={`task-assignee-label-${task.id}`}>Assignees</Label>
                    {/* F161 (AS-287, AS-288): multi-select assignee picker —
                        replaces the old single-value Select. Current set is
                        `task.assigneeIds` (falls back to the single legacy
                        `assigneeId` for a caller/task that predates this
                        feature — same fallback handleAssigneesToggle's own
                        "current" resolution uses). Reachable by keyboard: a
                        real focusable trigger button opens the popover, and
                        each row inside is itself a focusable, checkable
                        button (not a hover-only affordance) — this feature's
                        own clarified note. */}
                    {(() => {
                      const currentIds =
                        task.assigneeIds && task.assigneeIds.length > 0
                          ? task.assigneeIds
                          : task.assigneeId
                            ? [task.assigneeId]
                            : [];
                      const currentPeople: UserAvatarPerson[] = currentIds.map(
                        (id) => {
                          const member = members.find((m) => m.userId === id);
                          return {
                            id,
                            name: member?.name ?? null,
                            email: member?.email ?? null,
                            avatarUrl: member?.avatarUrl ?? null,
                            statusNote: member?.statusNote ?? null,
                            statusNoteUntil: member?.statusNoteUntil ?? null,
                          };
                        },
                      );
                      return (
                        <Popover>
                          <PopoverTrigger
                            render={
                              <button
                                type="button"
                                id={`task-assignee-${task.id}`}
                                aria-labelledby={`task-assignee-label-${task.id}`}
                                disabled={isAssigning || !canEdit}
                                title={editDisabledTitle}
                                className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            }
                          >
                            {isAssigning ? (
                              <Loader2
                                className="size-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : currentPeople.length > 0 ? (
                              <>
                                {/* BUGFIX: interactive=false — nested inside
                                    this PopoverTrigger's own <button>; see
                                    UserAvatarGroup's doc comment. Same bug,
                                    same fix as list-assignee-cell.tsx. */}
                                <UserAvatarGroup
                                  people={currentPeople}
                                  size="sm"
                                  interactive={false}
                                />
                                <span className="truncate text-muted-foreground">
                                  {currentPeople.length === 1
                                    ? memberLabel(
                                        members.find(
                                          (m) => m.userId === currentPeople[0]!.id,
                                        ) ?? {
                                          userId: currentPeople[0]!.id,
                                          name: currentPeople[0]!.name ?? null,
                                          email: currentPeople[0]!.email ?? null,
                                        },
                                      )
                                    : `${currentPeople.length} assignees`}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                Unassigned
                              </span>
                            )}
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64 p-1">
                            <div role="listbox" aria-multiselectable="true" aria-label="Assignees" className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                              {members.length === 0 && (
                                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                                  No workspace members.
                                </p>
                              )}
                              {members.map((member) => {
                                const checked = currentIds.includes(
                                  member.userId,
                                );
                                return (
                                  <button
                                    key={member.userId}
                                    type="button"
                                    role="option"
                                    aria-selected={checked}
                                    disabled={isAssigning || !canEdit}
                                    onClick={() =>
                                      handleAssigneesToggle(member.userId)
                                    }
                                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      tabIndex={-1}
                                      aria-hidden="true"
                                    />
                                    <UserAvatar
                                      person={{
                                        id: member.userId,
                                        name: member.name,
                                        email: member.email,
                                        avatarUrl: member.avatarUrl,
                                      }}
                                      size="sm"
                                    />
                                    <span className="truncate">
                                      {memberLabel(member)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                  </div>
                }
              />

              <TaskDetailSections
                task={task}
                members={members}
                attachments={attachments}
                timeEntries={timeEntries}
                activeTimer={activeTimer}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                timezone={timezone}
                onOpenTask={onOpenTask}
                attachmentListRef={attachmentListRef}
              />
              </div>
              {/* F010 will populate this column (right-rail fields).
                  Empty placeholder for now — the shell's job (F009) is
                  only to reserve the layout position. */}
              <div
                data-testid="detail-right-column"
                className="flex flex-col gap-6"
              />
            </div>

            <SheetFooter>
              <SaveAsTemplateDialog
                taskId={task.id}
                taskTitle={task.title}
                disabled={!canSaveTemplate}
                disabledTitle={saveTemplateDisabledTitle}
              />
              <Button
                type="button"
                variant="outline"
                disabled={isDuplicating || !canEdit}
                title={canEdit ? undefined : "You don't have permission to duplicate this task."}
                onClick={handleDuplicate}
              >
                {isDuplicating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Duplicating...
                  </>
                ) : (
                  <>
                    <Copy className="size-4" aria-hidden="true" />
                    Duplicate
                  </>
                )}
              </Button>
              {/* UX audit (Nalaz 5): "Delete task" is destructive and
                  irreversible, but sat stacked directly against
                  "Duplicate"/"Save as template" with identical spacing,
                  inviting an accidental click straight after one of those.
                  A Separator plus extra top margin gives it its own visual
                  group -- same destructive-action-gets-a-gap pattern this
                  codebase doesn't otherwise have a precedent for, so a
                  plain Separator (already used throughout this Sheet) was
                  reused rather than introducing a new pattern. The button
                  itself is untouched (still `variant="destructive"`,
                  still full-width, still the same click target) -- only
                  its position relative to the other two changed. */}
              <Separator className="mt-2" />
              <Button
                type="button"
                variant="destructive"
                className="mt-2"
                disabled={isDeleting || !canDelete}
                title={canDelete ? undefined : "You don't have permission to delete this task."}
                onClick={handleDelete}
              >
                {isDeleting ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete task
                  </>
                )}
              </Button>
            </SheetFooter>
          </AttachmentDropzone>
        )}
      </SheetContent>
    </Sheet>
  );
}
