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

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Copy,
  CornerUpLeft,
  Link as LinkIcon,
  Loader2,
  Repeat,
  TriangleAlert,
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

// F173 (AS-311): client-side mirror of lib/actions/tasks.ts's
// (unexported) `setTaskItemChecked` — duplicated rather than imported
// because the source of truth lives in a `"use server"` file, which can
// only export async Server Actions; a second, identical helper here is
// the simpler option (no shared non-server module to introduce just for
// one small pure function) for what's only ever used to compute the
// OPTIMISTIC preview before the real Server Action call resolves — the
// server's own copy is what actually persists.
function setJsonTaskItemChecked(
  doc: JSONContent | null | undefined,
  itemId: string,
  checked: boolean,
): JSONContent | null {
  if (!doc) return null;
  if (
    doc.type === "taskItem" &&
    (doc.attrs as { id?: unknown } | undefined)?.id === itemId
  ) {
    return { ...doc, attrs: { ...doc.attrs, checked } };
  }
  if (!Array.isArray(doc.content)) return null;
  for (let i = 0; i < doc.content.length; i++) {
    const updatedChild = setJsonTaskItemChecked(doc.content[i], itemId, checked);
    if (updatedChild) {
      const content = doc.content.slice();
      content[i] = updatedChild;
      return { ...doc, content };
    }
  }
  return null;
}

import {
  deleteTask,
  restoreTask,
  editTask,
  moveTaskStatus,
  setTaskAssignees,
  toggleDescriptionChecklistItem,
} from "@/lib/actions/tasks";
import { isOverdue } from "@/lib/tasks/is-overdue";
import { cn } from "@/lib/utils";
// F146 (AS-258): the single "KEY-NUMBER" formatter — see that file's doc
// comment for why every task-identity surface goes through it instead of
// re-concatenating projectKey/number locally.
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { EditTaskUpdates } from "@/lib/validation/tasks";
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
import { TagsEditor } from "@/components/task/tags-editor";
import {
  SubtaskList,
  type SubtaskListChildTask,
} from "@/components/task/subtask-list";
import { Checklist, type ChecklistListItem } from "@/components/task/checklist";
import {
  Dependencies,
  type DependencyRelatedTask,
} from "@/components/task/dependencies";
import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";
import { CommentList, type TaskComment } from "@/components/task/comment-list";
// F205 (AS-378): reuses the SAME Server Action F204 built for the comment
// composer's mention picker (lib/actions/comments.ts's getMentionCandidates
// is generic over `taskId`, not comment-specific — it already narrows to
// the task's own project-visibility-scoped member set) rather than adding
// a second, near-identical action for descriptions. See this feature's
// handoff, Decisions made.
import { getMentionCandidates } from "@/lib/actions/comments";
// F002 (missions/20260903-portal, AS-013): the phase Select's option
// source — same "Server Action called directly from a Client Component
// useEffect" pattern as getMentionCandidates immediately above, and the
// write path for the Select's own onValueChange.
import { getProjectPhaseOptions, setTaskPhase } from "@/lib/actions/phases";
import type { ProjectPhaseOption } from "@/lib/queries/phases";
import { toPlainJson } from "@/lib/comments/rich-text";
// F196 (AS-358, AS-361): the Comments/Activity toggle — see
// components/task/activity-feed.tsx's own doc comment for why a toggle
// was chosen over interleaving the two into one feed.
import { ActivityFeed } from "@/components/task/activity-feed";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AttachmentList,
  type AttachmentListHandle,
  type TaskAttachment,
} from "@/components/task/attachment-list";
import { AttachmentDropzone } from "@/components/task/attachment-dropzone";
import {
  TimeTracking,
  type TimeEntry,
  type TimeTrackingActiveTimer,
} from "@/components/task/time-tracking";
import { Watchers } from "@/components/task/watchers";
import { ClientVisibilityToggle } from "@/components/task/client-visibility-toggle";
import { PendingApprovalToggle } from "@/components/task/pending-approval-toggle";
// F008 (missions/20260903-portal, AS-019): the richer "raise a real
// approval request" path, shown beside PendingApprovalToggle rather than
// replacing it — that toggle stays the quick "waiting on client" flag,
// this dialog is the one that actually creates an approval_requests row
// with a decision type, a due date and a message.
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
// F179 (AS-317, AS-318, AS-319): the recurrence picker + remove control —
// same "smallest-possible-client-boundary, caller passes current value
// down, component calls its own Server Action" convention as TagsEditor/
// Checklist above.
import { RecurrenceEditor } from "@/components/task/recurrence-editor";
import type { RecurrenceRule } from "@/lib/recurrence/next-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
// F265 (AS-516): drives whether a MobileCollapsibleSection is actually
// collapsible right now -- see that component's own doc comment below.
import { useMediaQuery, MOBILE_BREAKPOINT_QUERY } from "@/lib/hooks/use-media-query";
// F122 (AS-214): "assignee pickers" includes this Sheet's own assignee
// control.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
// F161 (AS-287, AS-288): stacked avatar group for this task's full
// assignee set, header + trigger.
import { UserAvatarGroup } from "@/components/user-avatar-group";
// F171 (AS-307, AS-309): read-only rendering of the stored Tiptap document
// via F169's shared, allow-listed renderer — dynamically imported with
// `{ ssr: false }` per that component's own doc comment, since Tiptap's
// `useEditor` touches the DOM and this Sheet is otherwise SSR-eligible as
// a Client Component.
const RichTextRenderer = dynamic(
  () =>
    import("@/components/editor/rich-text-editor").then(
      (mod) => mod.RichTextRenderer,
    ),
  { ssr: false },
);

// F205 (AS-378): the SAME editable component F174 already wired into the
// comment composer (components/task/comment-list.tsx), dynamically
// imported the same "{ ssr: false }" way as RichTextRenderer above, for
// the identical Tiptap-touches-the-DOM reason. This is what turns the
// description field from a plain Textarea into a rich-text editor with
// the @-mention picker (mentionSuggestions below) — the same extension
// F203 built, enabled here for descriptions exactly as it already is for
// comments.
const RichTextEditor = dynamic(
  () =>
    import("@/components/editor/rich-text-editor").then(
      (mod) => mod.RichTextEditor,
    ),
  { ssr: false },
);

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
};

export type TaskDetailSheetMember = {
  userId: string;
  email: string | null;
  name: string | null;
  /** F122 (AS-214): optional so existing callers (tests, callers not yet
   * updated) don't have to pass it — a missing avatarUrl just means the
   * initials fallback renders instead of an image. */
  avatarUrl?: string | null;
};

const STATUS_LABELS: Record<TaskDetailSheetTask["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

const PRIORITY_LABELS: Record<
  NonNullable<TaskDetailSheetTask["priority"]>,
  string
> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
};

const NO_PRIORITY_VALUE = "__none__";

// F002 (missions/20260903-portal, AS-013): same reserved-sentinel
// convention as NO_PRIORITY_VALUE above — base-ui's Select doesn't accept
// an empty-string item value, and "no phase" is a real, selectable state.
const NO_PHASE_VALUE = "__no_phase__";

function memberLabel(member: TaskDetailSheetMember): string {
  return member.name || member.email || member.userId;
}

// F265 (AS-516): wraps a section (description, checklist, subtasks,
// comments/activity, time tracking -- the sections the clarified spec
// names) so it can be collapsed on phone widths, keeping the now
// full-screen Sheet navigable instead of one giant unbroken scroll.
//
// Defaults OPEN everywhere, including on first mobile render -- nothing
// is hidden by default; the trigger only gives the user the ABILITY to
// collapse a section they're not using right now. On desktop
// (`isMobile` false) the collapse toggle is not just visually hidden but
// functionally inert: `effectiveOpen` is forced `true` regardless of
// local `open` state, so a section a user collapsed while the viewport
// was narrow does not stay collapsed if the window is later resized to
// desktop width (a pure-CSS `max-sm:hidden` on the trigger alone would
// leave that stale `open: false` state in effect at desktop width too,
// since Collapsible's content-hiding is JS/data-state driven, not a CSS
// media query -- this is the exact class of "looks right in one
// viewport, silently wrong after a resize" bug this feature's brief
// warned to be alert to for this component, one level removed from
// F264's flex-basis bug but the same root cause: trusting a Tailwind
// class to gate something that isn't actually CSS-driven).
function MobileCollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT_QUERY);
  const [open, setOpen] = useState(true);
  const effectiveOpen = isMobile ? open : true;

  return (
    <Collapsible
      open={effectiveOpen}
      onOpenChange={setOpen}
      className="flex flex-col gap-2"
    >
      {/* `hidden max-sm:flex`: the trigger itself IS purely
          CSS-controlled (visible only below `sm`) -- unlike the content
          above, hiding a trigger button costs nothing if the viewport
          later changes, it just becomes unreachable, which is correct:
          at desktop width there is nothing to collapse (effectiveOpen is
          always true there). `min-h-11` (AS-518): this is itself a
          mobile-only-visible tap target, so it needs the same 44px
          minimum as every other control audited by this feature. */}
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="hidden min-h-11 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-sm font-medium text-foreground max-sm:flex"
          />
        }
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open ? "rotate-180" : "",
          )}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TaskDetailSheet({
  task,
  members,
  comments = [],
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
  highlightCommentId,
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
  const [title, setTitle] = useState(task?.title ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  // F236 (AS-453): sibling local state to dueDate above, same "local
  // mirror re-synced on task change" convention.
  const [startDate, setStartDate] = useState(task?.startDate ?? "");
  // F005 (missions/20260903-portal, AS-014): local mirrors of the Page
  // slug/order fields, same "re-synced on task change" convention as
  // title/dueDate/startDate above. Text inputs (not a date picker like
  // dueDate/startDate), so they commit on blur — mirrors handleTitleBlur's
  // own shape below, minus that field's dedicated transition/Escape
  // handling, which nothing here needs (see handlePageSlugBlur's own doc
  // comment).
  const [pageSlug, setPageSlug] = useState(task?.pageSlug ?? "");
  const [pageOrder, setPageOrder] = useState(
    task?.pageOrder != null ? String(task.pageOrder) : "",
  );
  // F173 (AS-311): local, optimistic mirror of `task.descriptionJson`,
  // same "local state re-synced on task change" shape as
  // title/description/dueDate above — needed so the Preview's inline
  // checkbox toggle can show the new checked state immediately and roll
  // back to the last-known-good document if the save fails, without
  // waiting on a full task refetch (this component receives `task` as a
  // prop from its caller, which only refreshes on its own schedule/
  // realtime event, not synchronously after this action resolves).
  const [descriptionJson, setDescriptionJson] = useState<
    JSONContent | null | undefined
  >(task?.descriptionJson);
  // Tracks which task's fields are currently loaded into local edit state,
  // so it can be re-synced below without an Effect (React docs: "adjusting
  // state when a prop changes" is done during render, not in a useEffect,
  // to avoid the extra cascading render an Effect would cause).
  const [syncedTaskId, setSyncedTaskId] = useState<string | null>(null);
  // F247 (AS-478): registered for as long as the Sheet is open — see the
  // import comment above.
  useEscapeLayer(open, () => onOpenChange(false));
  const [isSavingField, startSaveTransition] = useTransition();
  // F003 (AS-005, AS-006): the status Select's badge/value updates the
  // instant a change is chosen — no waiting on moveTaskStatus's round
  // trip — via React's built-in useOptimistic, mirroring
  // list-status-select.tsx's own local-state optimistic pattern but using
  // the dedicated hook since this value is derived straight from the
  // `task` prop (not a separately-synced local field like `title`/
  // `dueDate` above). useOptimistic auto-reverts to the base `task.status`
  // once the enclosing transition (handleStatusChange's
  // startSaveTransition below) settles, which is what produces AS-006's
  // "revert on failure" for free — no manual rollback needed. On success,
  // it likewise reverts to `task.status` until the caller's own
  // realtime/refetch path updates that prop, per this feature's clarified
  // "Realtime event ... reconciled after transition settles" answer.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    task?.status,
  );
  // F004/F014 (AS-007, AS-008): the Priority Select's own optimistic
  // mirror. Unlike optimisticStatus above, this cannot pass task?.priority
  // as the useOptimistic baseline: `??` can't distinguish "no override yet"
  // from "explicitly cleared to null", so a cleared priority would collapse
  // back to task.priority on every render (F014 fix). Instead the baseline
  // is always `undefined` ("no override"); `null` is a real, distinct
  // override value meaning "cleared to No priority". Display logic below
  // must use `!== undefined`, never `??`, to read this state.
  const [optimisticPriority, setOptimisticPriority] = useOptimistic<
    TaskDetailSheetTask["priority"] | undefined
  >(undefined);
  // F023 (AS-005, AS-007 fix): useOptimistic's own baseline (`task.status` /
  // `undefined`) is what the optimistic value reverts to once the
  // enclosing transition settles — including on SUCCESS, not just failure.
  // The `task` prop itself only moves on to the new value once the
  // caller's own refetch/realtime path catches up, which is not
  // synchronous with the Server Action resolving. Without a local,
  // separately-committed mirror, the badge visibly snaps back to the
  // stale `task.status`/`task.priority` for however long that gap lasts.
  // These two states are that mirror: set on a successful save, read
  // ahead of both the optimistic value and the `task` prop by the Select
  // `value` bindings below, and re-cleared whenever a different task is
  // synced in (so a freshly opened task never shows a stale confirmed
  // value from the previously open one).
  const [confirmedStatus, setConfirmedStatus] = useState<
    TaskDetailSheetTask["status"] | undefined
  >(undefined);
  const [confirmedPriority, setConfirmedPriority] = useState<
    TaskDetailSheetTask["priority"] | undefined
  >(undefined);
  // F002 (missions/20260903-portal, AS-013): the Phase Select's own
  // optimistic + confirmed mirror, same shape as Priority's above
  // (undefined baseline meaning "no override yet"; `null` is a real,
  // distinct override meaning "cleared to No phase").
  const [optimisticPhaseId, setOptimisticPhaseId] = useOptimistic<
    string | null | undefined
  >(undefined);
  const [confirmedPhaseId, setConfirmedPhaseId] = useState<
    string | null | undefined
  >(undefined);
  // F002 (AS-013): this task's project's phase options, fetched via
  // getProjectPhaseOptions (lib/actions/phases.ts) the same
  // "Server Action called from a useEffect" way visibleDescriptionMentionIds
  // fetches getMentionCandidates below — `null` (not yet resolved) means
  // "no options loaded yet", rendered as a disabled Select rather than an
  // empty one.
  const [phaseOptions, setPhaseOptions] = useState<ProjectPhaseOption[] | null>(
    null,
  );
  const [syncedPhaseOptionsProjectId, setSyncedPhaseOptionsProjectId] =
    useState<string | null>(null);
  const [isAssigning, startAssignTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  // F158 (AS-280, AS-281): the shared guard — see lib/tasks/
  // blocked-guard.ts's isDoneStatus doc comment for the full list of
  // callers this same hook is shared with.
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();

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

  // Re-sync local edit state whenever the sheet is opened for a (possibly
  // different) task, mirroring EditProjectDialog's handleOpenChange reset
  // convention.
  if (open && task && task.id !== syncedTaskId) {
    setSyncedTaskId(task.id);
    setTitle(task.title);
    setDueDate(task.dueDate ?? "");
    setStartDate(task.startDate ?? "");
    // F005 (AS-014): same re-sync convention as dueDate/startDate above.
    setPageSlug(task.pageSlug ?? "");
    setPageOrder(task.pageOrder != null ? String(task.pageOrder) : "");
    setDescriptionJson(task.descriptionJson);
    // F023: a newly opened task must never show a confirmed value carried
    // over from whatever task was previously open in this same Sheet.
    setConfirmedStatus(undefined);
    setConfirmedPriority(undefined);
    // F002 (AS-013): same reasoning for the phase mirror.
    setConfirmedPhaseId(undefined);
  } else if (!open && syncedTaskId !== null) {
    // Sheet closed — clear the sync marker so reopening the same task
    // (e.g. after an external update) re-syncs from the latest props.
    setSyncedTaskId(null);
  }

  function saveField(updates: EditTaskUpdates, successMessage: string) {
    if (!task) return;
    startSaveTransition(async () => {
      try {
        const result = await editTask(task.id, updates);
        if (result.ok) {
          toast.success(successMessage);
        } else {
          toast.error(result.error);
        }
      } catch {
        // F013: a thrown rejection (network loss, 500, serialization
        // error) gets the same toast treatment as an `{ ok: false }`
        // return — no separate revert needed here since this path has
        // no local optimistic mirror of its own.
        toast.error("Failed to save. Please try again.");
      }
    });
  }

  // F005 (AS-009, AS-010, AS-011): title gets its OWN transition, separate
  // from `isSavingField` (shared by status/priority/dueDate/startDate/
  // description above) — a dedicated pending flag so AS-009's "visual
  // saving indicator" reflects the title mutation specifically, matching
  // this Sheet's own established convention of a per-control transition
  // for anything that needs its own indicator (isAssigning, isDeleting).
  const [isSavingTitle, startTitleSaveTransition] = useTransition();
  // Escape's own revert (below) calls `element.blur()` synchronously to
  // commit the cancel — but that blur event fires with `title`'s CLOSURE
  // value from the current render, before the `setTitle(task.title)` state
  // update a few lines earlier in the same handler has actually been
  // applied. Without this guard, handleTitleBlur would read the
  // about-to-be-discarded edit (still "Discard me", not yet "reverted")
  // and save it — exactly backwards from Escape's contract. This ref (not
  // state — no render should ever depend on it) is set for the duration of
  // that synchronous blur() call only.
  const isCancellingTitleEditRef = useRef(false);

  function handleTitleBlur() {
    if (!task) return;
    if (isCancellingTitleEditRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(task.title);
      toast.error("Title can't be empty.");
      return;
    }
    if (trimmed.length > 500) {
      setTitle(task.title);
      toast.error("Title can't be longer than 500 characters.");
      return;
    }
    if (trimmed === task.title) {
      // AS-011: still counts as a commit (no separate dialog exists to
      // open) — just a no-op save since nothing actually changed.
      setTitle(task.title);
      return;
    }

    // AS-010: captured before the transition starts so a server failure
    // can revert the displayed title to exactly what it was pre-edit,
    // independent of whatever `task.title` prop value the caller's own
    // refetch/realtime path may have already moved on to by the time this
    // async call resolves.
    const previousTitle = task.title;
    startTitleSaveTransition(async () => {
      try {
        const result = await editTask(task.id, { title: trimmed });
        if (result.ok) {
          toast.success("Title updated.");
        } else {
          setTitle(previousTitle);
          toast.error(result.error);
        }
      } catch {
        setTitle(previousTitle);
        toast.error("Failed to save title");
      }
    });
  }

  // F005 (AS-011): Enter commits immediately (no Shift+Enter newline — this
  // is a single-line title, not the rich-text description below) by
  // blurring the input, which reuses handleTitleBlur's own save path — no
  // second, parallel commit implementation. Escape cancels the edit and
  // reverts to the last SAVED title (`task.title`, not whatever
  // `previousTitle` a prior in-flight save may have captured), then blurs
  // so the input doesn't stay focused on a value it just discarded.
  // `stopPropagation` keeps this a title-only cancel: F247's global
  // Escape-layer stack (useEscapeLayer above) listens on `document` and
  // would otherwise treat the same keystroke as "close the whole Sheet."
  function handleTitleKeyDown(keyEvent: React.KeyboardEvent<HTMLInputElement>) {
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      keyEvent.currentTarget.blur();
    } else if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      if (task) setTitle(task.title);
      isCancellingTitleEditRef.current = true;
      keyEvent.currentTarget.blur();
      isCancellingTitleEditRef.current = false;
    }
  }

  // F205 (AS-378): the description editor's own @-mention save path.
  // Replaces the former handleDescriptionBlur (which used to write the
  // legacy plain-text `description` column from a plain Textarea) —
  // RichTextEditor
  // below is bound to `descriptionJson` alone, and this writes ONLY
  // `updates.descriptionJson` (never `updates.description` in the same
  // call), matching the direct-write trigger condition
  // (20260822130000_task_description_json_direct_write.sql: a write that
  // changes description_json but NOT description is treated as
  // authoritative). See this feature's handoff, Decisions made, for why
  // the legacy plain-text column is intentionally left to go stale from
  // this write path rather than being back-derived here.
  function handleDescriptionJsonBlur() {
    if (!task || !canEdit) return;
    const previous = task.descriptionJson ?? null;
    const next = descriptionJson ?? null;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;

    startSaveTransition(async () => {
      // F340 (same bug class as F339, M18 scrutiny pass 2 FU-M18P2-1):
      // `next` is `descriptionJson`'s live optimistic mirror, ultimately
      // sourced from RichTextEditor's `onChange(updatedEditor.getJSON())` —
      // the exact same live-ProseMirror-document-reference shape that made
      // addComment/editComment 500 with "Cannot access id on the server"
      // when a real mention node's `attrs` crossed the Server Action
      // boundary un-cloned. `toPlainJson` here severs any lingering
      // reference identity to the live editor the same way F339's fix does
      // in comment-list.tsx.
      const result = await editTask(task.id, { descriptionJson: toPlainJson(next) });
      if (result.ok) {
        if ("descriptionJson" in result.data) {
          // The server may have stripped an invisible mention
          // (sanitiseMentionsForVisibility, AS-376's protection reused
          // for descriptions) — re-sync the local mirror to whatever was
          // actually persisted rather than trusting the optimistic buffer.
          setDescriptionJson(result.data.descriptionJson);
        }
        toast.success("Description updated.");
      } else {
        // Failure handling per Clarified implementation: the optimistic
        // change reverts and a toast states what failed in plain
        // language.
        setDescriptionJson(previous);
        toast.error(result.error);
      }
    });
  }

  // F205 (AS-378): the description editor's @-mention suggestion source —
  // exactly the same "narrowed, project-visibility-scoped id list via
  // getMentionCandidates" pattern comment-list.tsx already uses (see that
  // file's own doc comment on this same block for the full rationale).
  // `null` (not yet resolved) means "no suggestions offered yet", never
  // widened to the full `members` list, same safe default.
  const [visibleDescriptionMentionIds, setVisibleDescriptionMentionIds] =
    useState<string[] | null>(null);
  const [syncedDescriptionMentionTaskId, setSyncedDescriptionMentionTaskId] =
    useState<string | null>(null);
  if (task && task.id !== syncedDescriptionMentionTaskId) {
    setSyncedDescriptionMentionTaskId(task.id);
    setVisibleDescriptionMentionIds(null);
  }

  const taskIdForMentions = task?.id;
  useEffect(() => {
    if (!taskIdForMentions) return;
    let cancelled = false;
    getMentionCandidates(taskIdForMentions).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setVisibleDescriptionMentionIds(result.data.userIds);
      } else {
        setVisibleDescriptionMentionIds([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taskIdForMentions]);

  // F002 (missions/20260903-portal, AS-013): re-sync the phase-options
  // fetch trigger during render, same "adjust state while rendering,
  // don't setState-in-an-Effect" convention as syncedDescriptionMentionTaskId
  // above — `projectId` (not `task.id`) is the actual dependency, since
  // the option LIST is per-project, not per-task; re-fetching per task
  // inside the same project would be wasted network calls.
  if (task?.projectId && task.projectId !== syncedPhaseOptionsProjectId) {
    setSyncedPhaseOptionsProjectId(task.projectId);
    setPhaseOptions(null);
  }

  const projectIdForPhaseOptions = task?.projectId;
  useEffect(() => {
    if (!projectIdForPhaseOptions) return;
    let cancelled = false;
    getProjectPhaseOptions(projectIdForPhaseOptions).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPhaseOptions(result.data.phases);
      } else {
        setPhaseOptions([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectIdForPhaseOptions]);

  const descriptionMentionSuggestions = members
    .filter(
      (member) =>
        visibleDescriptionMentionIds !== null &&
        visibleDescriptionMentionIds.includes(member.userId),
    )
    .map((member) => ({
      id: member.userId,
      label: member.name || member.email || member.userId,
    }));

  // F173 (AS-311): inline toggle for a checkbox inside the description's
  // rich-text Preview — permission-checked (`canEdit`, same gate as every
  // other field on this Sheet) and persisted through a dedicated Server
  // Action, WITHOUT opening a full editor. Optimistic: the local
  // `descriptionJson` mirror is updated immediately (so `RichTextRenderer`
  // re-syncs and the checkbox visually reflects the click right away,
  // per that component's own optimistic-by-design `onReadOnlyChecked`
  // contract), then rolled back with a toast if the Server Action fails.
  async function handleToggleDescriptionChecklistItem(
    itemId: string | null,
    checked: boolean,
  ): Promise<boolean> {
    if (!task || !canEdit || !itemId) return false;

    const previous = descriptionJson;
    const optimistic = setJsonTaskItemChecked(previous, itemId, checked);
    if (optimistic) setDescriptionJson(optimistic);

    const result = await toggleDescriptionChecklistItem(
      task.id,
      itemId,
      checked,
    );

    if (result.ok) {
      setDescriptionJson(result.data.descriptionJson);
      return true;
    }

    // Roll back to the last-known-good document and surface why, per the
    // clarified failure-handling answer ("the optimistic change reverts
    // and a sonner toast states what failed in plain language").
    setDescriptionJson(previous);
    toast.error(result.error);
    return false;
  }

  // F158 (AS-280, AS-281): status editing ships with this feature — see
  // this file's own former comment on the Select below (now removed) for
  // the prior "no Server Action persists status" limitation. Reuses
  // `moveTaskStatus` (lib/actions/tasks.ts, F045), the SAME action the
  // board's drag-and-drop and the list view's inline select already call
  // — no second status-mutation path. Mirrors handlePriorityChange's own
  // shape (direct value + onValueChange + toast, no local optimistic
  // override — this Select's `value` stays bound straight to `task.status`
  // exactly like priority's own Select does), with one addition: the
  // shared blocked-done guard is awaited FIRST, before the mutation is
  // even attempted, exactly like list-status-select.tsx's handleChange.
  async function handleStatusChange(value: string | null) {
    if (!task || value === null) return;
    const next = value as TaskDetailSheetTask["status"];
    const currentStatus = confirmedStatus ?? optimisticStatus ?? task.status;
    if (next === currentStatus) return;

    const proceed = await confirmIfMovingToDone(task.id, next);
    if (!proceed) return;

    const nextLabel = STATUS_LABELS[next];
    // F024: clear the confirmed mirror as a plain, non-transition update,
    // BEFORE entering startSaveTransition below — otherwise a stale
    // confirmedStatus from a PRIOR successful save masks this new
    // optimistic value during the transition (2nd+ change in the same open
    // sheet). Ordinary `useState` setters called INSIDE a transition are
    // deferred until that transition settles (unlike `useOptimistic`'s own
    // dispatcher, which is specifically designed to render immediately) —
    // so clearing it here, ahead of the transition, is what actually makes
    // it take effect before the badge re-renders.
    setConfirmedStatus(undefined);
    startSaveTransition(async () => {
      // AS-005: applied synchronously, inside this same transition, before
      // the `await` below — the Select's value/badge (bound to
      // `optimisticStatus` further down) re-renders with the new status
      // immediately, without waiting on moveTaskStatus's server round trip.
      setOptimisticStatus(next);
      try {
        const result = await moveTaskStatus(task.id, next);
        if (result.ok) {
          // F023 (AS-005): commit the confirmed value so the badge stays
          // on `next` even after this transition settles and
          // useOptimistic's own baseline reverts — see confirmedStatus's
          // doc comment above.
          setConfirmedStatus(next);
          toast.success("Status updated.");
        } else {
          // AS-006: useOptimistic itself reverts `optimisticStatus` back to
          // the base `task.status` once this transition settles (see the
          // hook's own doc comment above) — this toast is the ONLY manual
          // work a failure needs, phrased with the target status name per
          // this feature's clarified failure-handling answer.
          toast.error(`Failed to set status to ${nextLabel}`);
        }
      } catch {
        // F013: a thrown rejection (network loss, 500, serialization
        // error) is treated identically to an `{ ok: false }` return —
        // useOptimistic still reverts automatically once this transition
        // settles.
        toast.error(`Failed to set status to ${nextLabel}`);
      }
    });
  }

  // F004 (AS-007, AS-008): mirrors handleStatusChange's own shape above —
  // the optimistic value is applied synchronously, inside the same
  // transition, BEFORE the await, so the badge updates before editTask's
  // server round trip resolves (AS-007). useOptimistic's own automatic
  // revert-when-transition-settles behavior handles AS-008; the toast is
  // the only manual work a failure needs.
  function handlePriorityChange(value: string | null) {
    if (!task) return;
    const next =
      value && value !== NO_PRIORITY_VALUE
        ? (value as NonNullable<TaskDetailSheetTask["priority"]>)
        : null;
    const currentPriority =
      confirmedPriority !== undefined
        ? confirmedPriority
        : optimisticPriority !== undefined
          ? optimisticPriority
          : task.priority;
    if (next === currentPriority) return;

    const nextLabel = next ? PRIORITY_LABELS[next] : "No priority";
    // F024: clear the confirmed mirror as a plain, non-transition update,
    // BEFORE entering startSaveTransition below — see handleStatusChange's
    // own comment above for why this must happen outside the transition to
    // actually take effect before the badge re-renders.
    setConfirmedPriority(undefined);
    startSaveTransition(async () => {
      setOptimisticPriority(next);
      try {
        const result = await editTask(task.id, { priority: next });
        if (result.ok) {
          // F023 (AS-007): same "commit a confirmed value" fix as
          // handleStatusChange above.
          setConfirmedPriority(next);
          toast.success("Priority updated.");
        } else {
          toast.error(`Failed to set priority to ${nextLabel}`);
        }
      } catch {
        // F013: a thrown rejection gets the same toast as an
        // `{ ok: false }` return; useOptimistic still reverts
        // automatically once this transition settles.
        toast.error(`Failed to set priority to ${nextLabel}`);
      }
    });
  }

  // F002 (missions/20260903-portal, AS-013): mirrors handlePriorityChange's
  // own shape exactly, one field over.
  function handlePhaseChange(value: string | null) {
    if (!task) return;
    const next = value && value !== NO_PHASE_VALUE ? value : null;
    const currentPhaseId =
      confirmedPhaseId !== undefined
        ? confirmedPhaseId
        : optimisticPhaseId !== undefined
          ? optimisticPhaseId
          : (task.phaseId ?? null);
    if (next === currentPhaseId) return;

    const nextLabel =
      phaseOptions?.find((option) => option.id === next)?.name ?? "No phase";
    setConfirmedPhaseId(undefined);
    startSaveTransition(async () => {
      setOptimisticPhaseId(next);
      try {
        const result = await setTaskPhase(task.id, next);
        if (result.ok) {
          setConfirmedPhaseId(next);
          toast.success("Phase updated.");
        } else {
          toast.error(result.error || `Failed to set phase to ${nextLabel}`);
        }
      } catch {
        toast.error(`Failed to set phase to ${nextLabel}`);
      }
    });
  }

  function handleDueDateChange(value: string) {
    setDueDate(value);
    if (!task) return;
    const next = value || null;
    if (next === (task.dueDate ?? null)) return;
    saveField({ dueDate: next }, "Due date updated.");
  }

  // F236 (AS-453): mirrors handleDueDateChange above exactly. A
  // start-date-after-due-date combination is rejected server-side (Zod
  // cross-field refine, then the DB CHECK as the last line of defense —
  // see editTaskSchema/tasks_start_date_not_after_due_date) and surfaced
  // via the same toast.error(result.error) path saveField already uses,
  // so no extra client-side validation is duplicated here.
  function handleStartDateChange(value: string) {
    setStartDate(value);
    if (!task) return;
    const next = value || null;
    if (next === (task.startDate ?? null)) return;
    saveField({ startDate: next }, "Start date updated.");
  }

  // F005 (missions/20260903-portal, AS-014): unlike dueDate/startDate
  // (native date pickers, one onChange per real selection) these are
  // free-typed text/number inputs — saving on every keystroke would be
  // wrong, so this commits on blur, the same moment title's own edit
  // commits (handleTitleBlur above). Reuses the shared `saveField`/
  // `isSavingField` transition (dueDate/startDate/phase's convention),
  // not title's dedicated transition — nothing here needs a per-field
  // spinner or Escape-to-cancel, so the simpler of this file's two
  // existing commit patterns is the one actually reused.
  function handlePageSlugBlur() {
    if (!task) return;
    const trimmed = pageSlug.trim().toLowerCase();
    const next = trimmed === "" ? null : trimmed;
    if (next !== trimmed) setPageSlug(next ?? "");
    if (next === (task.pageSlug ?? null)) return;
    saveField({ pageSlug: next }, "Page slug updated.");
  }

  function handlePageOrderBlur() {
    if (!task) return;
    const trimmed = pageOrder.trim();
    if (trimmed === "") {
      if ((task.pageOrder ?? null) === null) return;
      saveField({ pageOrder: null }, "Page order updated.");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      setPageOrder(task.pageOrder != null ? String(task.pageOrder) : "");
      toast.error("Page order must be a whole number.");
      return;
    }
    if (parsed === (task.pageOrder ?? null)) return;
    saveField({ pageOrder: parsed }, "Page order updated.");
  }

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
        className="w-full sm:max-w-2xl data-[side=right]:sm:max-w-2xl data-[side=left]:sm:max-w-2xl max-sm:data-[side=right]:w-full max-sm:data-[side=right]:max-w-none max-sm:data-[side=left]:w-full max-sm:data-[side=left]:max-w-none max-sm:h-svh max-sm:max-h-svh max-sm:rounded-none max-sm:border-0"
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
            </SheetHeader>
            <div className="flex flex-col gap-6 overflow-y-auto px-6">
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor={`task-title-${task.id}`}
                  className="inline-flex items-center gap-1.5"
                >
                  Title
                  {/* AS-009: pending indicator, shown for as long as the
                      title save is in flight — same Loader2 spinner this
                      Sheet already uses for the assignee picker's
                      isAssigning state above. */}
                  {isSavingTitle && (
                    <Loader2
                      className="size-3 animate-spin text-muted-foreground"
                      aria-hidden="true"
                      data-testid="title-saving-indicator"
                    />
                  )}
                  <span className="sr-only" role="status">
                    {isSavingTitle ? "Saving title…" : ""}
                  </span>
                </Label>
                <Input
                  id={`task-title-${task.id}`}
                  value={title}
                  disabled={isSavingTitle || isSavingField || !canEdit}
                  title={editDisabledTitle}
                  maxLength={500}
                  onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  className="text-base font-medium"
                />
              </div>

              {/* Metadata block: status/priority/assignee/due date grouped
                  together in a dense grid so a reader can scan the
                  important fields before scrolling past the description or
                  any of the list-heavy sections below. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-5">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`task-status-${task.id}`}>Status</Label>
                  {/* F158 (AS-280, AS-281): status editing ships with this
                      feature via moveTaskStatus (see handleStatusChange
                      above) — the SAME action the board's drag-and-drop
                      and the list view's inline select already call.
                      Moving to "done" while this task still has open
                      blockers routes through the shared
                      confirmIfMovingToDone guard first. No local
                      optimistic override, matching the Priority Select
                      immediately below: `value` stays bound directly to
                      `task.status`. */}
                  <Select
                    value={confirmedStatus ?? optimisticStatus ?? task.status}
                    onValueChange={handleStatusChange}
                    disabled={isSavingField || !canEdit}
                  >
                    <SelectTrigger
                      id={`task-status-${task.id}`}
                      className="w-full"
                    >
                      <SelectValue>
                        {(value: string) =>
                          STATUS_LABELS[value as keyof typeof STATUS_LABELS] ??
                          value
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`task-priority-${task.id}`}>Priority</Label>
                  <Select
                    value={
                      (confirmedPriority !== undefined
                        ? confirmedPriority
                        : optimisticPriority !== undefined
                          ? optimisticPriority
                          : task.priority) ?? NO_PRIORITY_VALUE
                    }
                    onValueChange={handlePriorityChange}
                    disabled={isSavingField || !canEdit}
                  >
                    <SelectTrigger
                      id={`task-priority-${task.id}`}
                      className="w-full"
                    >
                      <SelectValue placeholder="No priority">
                        {(value: string) =>
                          value === NO_PRIORITY_VALUE
                            ? "No priority"
                            : (PRIORITY_LABELS[
                                value as keyof typeof PRIORITY_LABELS
                              ] ?? value)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRIORITY_VALUE}>
                        No priority
                      </SelectItem>
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  {/* F002 (missions/20260903-portal, AS-013): a task can
                      be assigned to (or cleared from) one of its project's
                      phases from here — mirrors the Priority Select's own
                      shape immediately above, one field over. Disabled
                      until phaseOptions has resolved (see the
                      getProjectPhaseOptions effect above) so a caller
                      never sees an empty "no options" flash before the
                      real list arrives. */}
                  <Label htmlFor={`task-phase-${task.id}`}>Phase</Label>
                  <Select
                    value={
                      (confirmedPhaseId !== undefined
                        ? confirmedPhaseId
                        : optimisticPhaseId !== undefined
                          ? optimisticPhaseId
                          : (task.phaseId ?? null)) ?? NO_PHASE_VALUE
                    }
                    onValueChange={handlePhaseChange}
                    disabled={isSavingField || !canEdit || phaseOptions === null}
                  >
                    <SelectTrigger
                      id={`task-phase-${task.id}`}
                      className="w-full"
                    >
                      <SelectValue placeholder="No phase">
                        {(value: string) =>
                          value === NO_PHASE_VALUE
                            ? "No phase"
                            : (phaseOptions?.find((option) => option.id === value)
                                ?.name ?? value)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PHASE_VALUE}>No phase</SelectItem>
                      {(phaseOptions ?? []).map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
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

                <div className="flex flex-col gap-2">
                <Label htmlFor={`task-start-date-${task.id}`}>
                  Start date
                </Label>
                <Input
                  id={`task-start-date-${task.id}`}
                  type="date"
                  value={startDate ?? ""}
                  disabled={isSavingField || !canEdit}
                  title={editDisabledTitle}
                  onChange={(changeEvent) =>
                    handleStartDateChange(changeEvent.target.value)
                  }
                />
                </div>

                <div className="flex flex-col gap-2">
                <Label
                  htmlFor={`task-due-date-${task.id}`}
                  className={cn(
                    isOverdue(task.dueDate, task.status, timezone, task.statusCategory) &&
                      "inline-flex items-center gap-1 text-destructive",
                  )}
                >
                  {isOverdue(task.dueDate, task.status, timezone, task.statusCategory) && (
                    <TriangleAlert className="size-3" aria-hidden="true" />
                  )}
                  Due date
                  {isOverdue(task.dueDate, task.status, timezone, task.statusCategory) && (
                    <span className="sr-only">(overdue)</span>
                  )}
                </Label>
                <Input
                  id={`task-due-date-${task.id}`}
                  type="date"
                  value={dueDate ?? ""}
                  disabled={isSavingField || !canEdit}
                  title={editDisabledTitle}
                  onChange={(changeEvent) =>
                    handleDueDateChange(changeEvent.target.value)
                  }
                  className={cn(
                    isOverdue(task.dueDate, task.status, timezone, task.statusCategory) &&
                      "border-destructive text-destructive",
                  )}
                />
                </div>
              </div>

              {/* F006c (missions/20260903-portal, AS-014): Page slug/
                  order only render for a task whose own task type
                  carries `system_key = 'page'` — NOT a name match.
                  F005's original name-based gate
                  (`taskTypeName === "page"`) meant a workspace whose page
                  type was named "Sida" (F005b exists precisely to serve
                  that workspace) could never see or order these fields,
                  and the converse: renaming an unrelated type to "Page"
                  would show them on tasks the Pages view would never
                  list (M1-scrutiny.md's B4). `taskTypeSystemKey`
                  undefined/null (a caller that hasn't been updated, or a
                  task whose type carries no portal role) hides this
                  section entirely — this Sheet's own "safe default"
                  convention, and the Definition of done's own "hidden for
                  non-page tasks" requirement. */}
              {task.taskTypeSystemKey === "page" && (
                <div
                  data-testid="page-fields"
                  className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border bg-muted/30 p-4"
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`task-page-slug-${task.id}`}>
                      Page slug
                    </Label>
                    <Input
                      id={`task-page-slug-${task.id}`}
                      value={pageSlug}
                      disabled={isSavingField || !canEdit}
                      title={editDisabledTitle}
                      placeholder="e.g. about-us"
                      className="font-mono text-sm"
                      onChange={(changeEvent) =>
                        setPageSlug(changeEvent.target.value)
                      }
                      onBlur={handlePageSlugBlur}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`task-page-order-${task.id}`}>
                      Page order
                    </Label>
                    <Input
                      id={`task-page-order-${task.id}`}
                      type="number"
                      inputMode="numeric"
                      value={pageOrder}
                      disabled={isSavingField || !canEdit}
                      title={editDisabledTitle}
                      placeholder="Unordered"
                      onChange={(changeEvent) =>
                        setPageOrder(changeEvent.target.value)
                      }
                      onBlur={handlePageOrderBlur}
                    />
                  </div>
                </div>
              )}

              <MobileCollapsibleSection title="Description">
                <Label htmlFor={`task-description-${task.id}`}>
                  Description
                </Label>
                {/* F205 (AS-378): the plain Textarea is replaced with the
                   shared RichTextEditor (F169/F174's same component,
                   already wired into the comment composer), bound to
                   `descriptionJson` — this is what enables the same
                   @-mention picker (F203) for descriptions, with the same
                   server-side visibility enforcement (F204's
                   sanitiseMentionsForVisibility, reused unchanged by
                   editTask) protecting it. The read-only Preview below is
                   UNCHANGED from F173 (AS-311) — this feature does not
                   touch its inline checkbox-toggle behaviour, only the
                   editing surface above it. */}
                <RichTextEditor
                  content={descriptionJson}
                  onChange={setDescriptionJson}
                  onBlur={handleDescriptionJsonBlur}
                  disabled={isSavingField || !canEdit}
                  placeholder="Add a description..."
                  aria-label={`Description for ${task.title}`}
                  mentionSuggestions={descriptionMentionSuggestions}
                />
                {/* F171 (AS-307, AS-309): the safe, formatted rendering of
                   the same description, sourced from `description_json`.
                   Only shown when there is real content beyond an empty
                   doc. F173 (AS-311): checkboxes inside this preview are
                   toggle-able right here — unchanged by this feature. */}
                {descriptionJson &&
                  Array.isArray(descriptionJson.content) &&
                  descriptionJson.content.length > 0 && (
                    <div className="rounded-lg border border-input bg-muted/30 px-3 py-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Preview
                      </p>
                      <RichTextRenderer
                        content={descriptionJson}
                        aria-label="Description preview"
                        mentionSuggestions={descriptionMentionSuggestions}
                        onToggleTaskItem={
                          canEdit
                            ? handleToggleDescriptionChecklistItem
                            : undefined
                        }
                      />
                    </div>
                  )}
              </MobileCollapsibleSection>

              <TagsEditor
                taskId={task.id}
                tags={task.tags}
                currentUserRole={currentUserRole}
              />

              <Separator />

              <RecurrenceEditor
                taskId={task.id}
                recurrence={task.recurrence ?? null}
                currentUserRole={currentUserRole}
              />

              <Separator />

              <MobileCollapsibleSection title="Subtasks">
                <SubtaskList
                  taskId={task.id}
                  projectId={task.projectId}
                  childTasks={task.children ?? []}
                  members={members}
                  onOpenTask={onOpenTask}
                />
              </MobileCollapsibleSection>

              <Separator />

              <MobileCollapsibleSection title="Checklist">
                <Checklist
                  taskId={task.id}
                  items={task.checklistItems ?? []}
                  currentUserRole={currentUserRole}
                />
              </MobileCollapsibleSection>

              <Separator />

              <Dependencies
                taskId={task.id}
                blockedBy={task.dependencies?.blockedBy ?? []}
                blocks={task.dependencies?.blocks ?? []}
                onOpenTask={onOpenTask}
              />

              <Separator />

              {/* F196 (AS-358, AS-361): "Comments" keeps CommentList's
                  existing full-featured rendering unchanged; "Activity"
                  is the read-only day-grouped chronicle of every
                  task_activity entry (field changes, plus comment
                  add/delete EVENTS per AS-356 — not their content). */}
              <MobileCollapsibleSection title="Comments & activity">
                <Tabs defaultValue="comments">
                  <TabsList>
                    <TabsTrigger value="comments">Comments</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>
                  <TabsContent value="comments">
                    <CommentList
                      taskId={task.id}
                      comments={comments}
                      members={members}
                      currentUserId={currentUserId}
                      currentUserRole={currentUserRole}
                      highlightCommentId={highlightCommentId}
                    />
                  </TabsContent>
                  <TabsContent value="activity">
                    <ActivityFeed
                      taskId={task.id}
                      timezone={timezone}
                      members={members}
                    />
                  </TabsContent>
                </Tabs>
              </MobileCollapsibleSection>

              <Separator />

              <AttachmentList
                ref={attachmentListRef}
                taskId={task.id}
                attachments={attachments}
                members={members}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
              />

              <Separator />

              <MobileCollapsibleSection title="Time tracking">
                <TimeTracking
                  taskId={task.id}
                  timeEntries={timeEntries}
                  members={members}
                  estimateMinutes={task.estimateMinutes}
                  activeTimer={activeTimer}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                />
              </MobileCollapsibleSection>
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
                variant="destructive"
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

        {/* F158 (AS-280, AS-281): the mark-as-done-anyway confirmation
            dialog — closed/inert unless handleStatusChange's
            confirmIfMovingToDone call above is currently waiting on a
            decision. Rendered inside SheetContent (not as a sibling of
            <Sheet>) so no other markup in this file needs reindenting;
            AlertDialog portals its own content to the document body
            regardless of where it sits in the React tree, so this
            placement has no effect on where it visually renders. */}
        {blockedDoneDialog}
      </SheetContent>
    </Sheet>
  );
}
