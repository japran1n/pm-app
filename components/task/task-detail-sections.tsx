"use client";

// ARCH-005 (audit 2026-09-13): extracted verbatim from
// components/task/task-detail-sheet.tsx — the feature-panel composition
// block (Tags/Recurrence/Subtasks/Checklist/Activity/Attachments/Time
// tracking) that follows the field-editing surface
// (components/task/task-detail-fields.tsx). Pure composition: every panel
// here owns its own state and Server Action calls; this component only
// threads the Sheet's props through, exactly as the Sheet itself did.

import type { RefObject } from "react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import { TagsEditor } from "@/components/task/tags-editor";
import { SubtaskList } from "@/components/task/subtask-list";
import { Checklist } from "@/components/task/checklist";
// F196 (AS-358, AS-361): the Comments/Activity toggle — see
// components/task/activity-feed.tsx's own doc comment for why a toggle
// was chosen over interleaving the two into one feed.
import { ActivityFeed } from "@/components/task/activity-feed";
import {
  AttachmentList,
  type AttachmentListHandle,
  type TaskAttachment,
} from "@/components/task/attachment-list";
import {
  TimeTracking,
  type TimeEntry,
  type TimeTrackingActiveTimer,
} from "@/components/task/time-tracking";
// F179 (AS-317, AS-318, AS-319): the recurrence picker + remove control —
// same "smallest-possible-client-boundary, caller passes current value
// down, component calls its own Server Action" convention as TagsEditor/
// Checklist above.
import { RecurrenceEditor } from "@/components/task/recurrence-editor";
// F157 (AS-277, AS-282) — restored 2026-09-14 (audit follow-up): the
// section was removed by a product-cleanup commit, but that left the
// dependency feature with NO management UI anywhere while the
// blocked-done guard still enforced blockers users could neither see
// nor clear. Decision by the session owner: restore a compact
// Dependencies section here, wired exactly like the sibling
// Subtasks/Checklist sections.
import { Dependencies } from "@/components/task/dependencies";
import { MobileCollapsibleSection } from "@/components/task/task-detail-fields";
import type {
  TaskDetailSheetMember,
  TaskDetailSheetTask,
} from "@/components/task/task-detail-sheet";

export function TaskDetailSections({
  task,
  members,
  attachments,
  timeEntries,
  activeTimer,
  currentUserId,
  currentUserRole,
  timezone,
  onOpenTask,
  attachmentListRef,
}: {
  task: TaskDetailSheetTask;
  members: TaskDetailSheetMember[];
  attachments: TaskAttachment[];
  timeEntries: TimeEntry[];
  activeTimer: TimeTrackingActiveTimer | null;
  currentUserId?: string;
  currentUserRole?: WorkspaceRole;
  timezone: string;
  onOpenTask?: (taskId: string) => void;
  /** F258 (AS-501, AS-503): the Sheet owns this ref — its
   * AttachmentDropzone wrapper calls straight into AttachmentList's
   * imperative handle so a drag-drop upload funnels through the exact
   * same Server Action + local-state path the file-picker input already
   * uses — no parallel upload implementation. */
  attachmentListRef: RefObject<AttachmentListHandle | null>;
}) {
  return (
    <>
      {/* F513 (design cleanup): every section from here down
          (Tags/Recurrence/Subtasks/Checklist/Activity/Attachments/
          Time tracking) is separated by a Separator — Description
          was the one gap in that rhythm, sitting flush against
          Tags with nothing but the shared `gap-6` between two
          otherwise-unrelated sections. */}
      <Separator />

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

      {/* F157 (AS-277, AS-282): Dependencies ("Blocked by"/"Blocks")
          restored 2026-09-14 — see the import comment above. The data
          rides on `task.dependencies` (getTaskDetail), defaulting to
          empty arrays for callers/fixtures that don't pass it, same
          "safe default" convention as `children`/`checklistItems`. */}
      <MobileCollapsibleSection title="Dependencies">
        <Dependencies
          taskId={task.id}
          blockedBy={task.dependencies?.blockedBy ?? []}
          blocks={task.dependencies?.blocks ?? []}
          onOpenTask={onOpenTask}
        />
      </MobileCollapsibleSection>

      <Separator />

      {/* F196 (AS-358, AS-361) Comments tab removed from this view
          per product decision — only the read-only day-grouped
          Activity chronicle remains. Comment data/actions
          (lib/actions/comments.ts) are untouched; comments still
          exist in the database, just not surfaced here. */}
      <MobileCollapsibleSection title="Activity">
        {/* F513 (design cleanup): unlike Subtasks/Checklist/Tags/
            Attachments/Time tracking, ActivityFeed renders no
            top-level heading of its own (only per-day group
            labels) — on desktop, where MobileCollapsibleSection's
            own title is CSS-hidden, this section had no visible
            name at all. Matches every sibling section's own
            internal `<Label>` convention. */}
        <Label>Activity</Label>
        <ActivityFeed
          taskId={task.id}
          timezone={timezone}
          members={members}
        />
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
          taskTags={task.tags}
          timeEntries={timeEntries}
          members={members}
          estimateMinutes={task.estimateMinutes}
          activeTimer={activeTimer}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      </MobileCollapsibleSection>
    </>
  );
}
