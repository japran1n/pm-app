import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getOverdueCount,
  getCompletedCount,
  getUnassignedCount,
  getKpiDelta,
} from "@/lib/queries/dashboard";
import { logger } from "@/lib/observability/logger";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { resolvePeople } from "@/lib/queries/people";
import {
  getMyTasks,
  getQaReturns,
  type MyTasksBuckets,
  type QaReturnItem,
} from "@/lib/queries/my-tasks";
import {
  getOpenApprovalsForWorkspace,
  type WorkspaceApproval,
} from "@/lib/queries/approvals";
import {
  getWorkspaceClientRequests,
  type TeamClientRequest,
} from "@/lib/queries/client-requests";
import {
  getNotificationsForWorkspace,
  type NotificationListItem,
} from "@/lib/queries/notifications";
import {
  getActiveTimer,
  getPersonTimeEntriesInRange,
  getWorkspaceTimeByPerson,
  type ActiveTimer,
} from "@/lib/queries/time-entries";
import {
  getCalendarBlocks,
  type CalendarBlock,
} from "@/lib/queries/calendar-blocks";
import {
  getMyProjectsProgress,
  type MyProjectProgress,
} from "@/lib/queries/projects";
import { getPersonalTodos } from "@/lib/queries/personal-todos";

import { HomeGreeting } from "@/components/dashboard/home-greeting";
import { NeedsYouCard, type AttentionItem } from "@/components/dashboard/needs-you-card";
import { MyWorkCard } from "@/components/dashboard/my-work-card";
import { TodayTimeCard } from "@/components/dashboard/today-time-card";
import { ComingUpCard } from "@/components/dashboard/coming-up-card";
import { MyProjectsGrid } from "@/components/dashboard/my-projects-grid";
import { TeamHealthSection } from "@/components/dashboard/team-health-section";
import type { WorkloadCardMember } from "@/components/dashboard/workload-card";
import { PersonalTodoList } from "@/components/my-tasks/personal-todo-list";

import type { WorkspaceRole } from "@/lib/auth/permissions";

const TARGET_MINUTES_PER_DAY = 480; // 8h
const TARGET_MINUTES_PER_WEEK = 2400; // 40h

function unwrap<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  label: string,
): T {
  if (result.status === "fulfilled") {
    return result.value;
  }
  logger.error(`[home-dashboard] ${label} failed: ${String(result.reason)}`);
  return fallback;
}

function todayIsoRange(timezone: string): { start: string; end: string } {
  // The date-only string for "today" — matches this codebase's existing
  // DateOnly convention for entry_date comparisons (YYYY-MM-DD).
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(new Date());
  return { start: today, end: today };
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();

  const [ctx, timezone] = await Promise.all([
    getWorkspaceContext(workspaceSlug),
    getCurrentUserTimezone(supabase),
  ]);

  const { user, workspace, role } = ctx;

  if (!workspace) {
    redirect("/onboarding");
  }

  if (!user) {
    redirect("/login");
  }

  const workspaceId = workspace.id;
  const userId = user.id;
  const resolvedRole = (role ?? "guest") as WorkspaceRole;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { start: todayStart, end: todayEnd } = todayIsoRange(timezone);

  const [
    peopleResult,
    myTasksResult,
    approvalsResult,
    clientRequestsResult,
    notificationsResult,
    qaReturnsResult,
    activeTimerResult,
    timeEntriesTodayResult,
    calendarBlocksResult,
    myProjectsResult,
    overdueCurResult,
    overdueDeltaResult,
    completedCurResult,
    completedDeltaResult,
    unassignedResult,
    workloadResult,
    membersResult,
    personalTodosResult,
  ] = await Promise.allSettled([
    resolvePeople([userId]),
    getMyTasks(workspaceId, userId, timezone),
    getOpenApprovalsForWorkspace(workspaceId),
    resolvedRole !== "member"
      ? getWorkspaceClientRequests(workspaceId)
      : Promise.resolve<{ list: TeamClientRequest[] }>({ list: [] }),
    getNotificationsForWorkspace(workspaceId, 20),
    getQaReturns(workspaceId, userId),
    getActiveTimer(),
    getPersonTimeEntriesInRange(userId, todayStart, todayEnd),
    getCalendarBlocks(workspaceId, now.toISOString(), weekOut.toISOString(), [userId]),
    getMyProjectsProgress(workspaceId, userId),
    getOverdueCount(supabase, workspaceId, timezone),
    getKpiDelta(workspaceId, "overdue", 7),
    getCompletedCount(supabase, workspaceId, timezone),
    getKpiDelta(workspaceId, "completed", 7),
    getUnassignedCount(workspaceId),
    getWorkspaceTimeByPerson(
      workspaceId,
      weekAgo.toISOString().slice(0, 10),
      now.toISOString().slice(0, 10),
    ),
    getWorkspaceMembers(workspaceId),
    getPersonalTodos(workspaceId),
  ]);

  const people = unwrap(peopleResult, new Map(), "resolvePeople");
  const myTasks = unwrap<MyTasksBuckets>(
    myTasksResult,
    { overdue: [], today: [], thisWeek: [], later: [] },
    "getMyTasks",
  );
  const approvals = unwrap<{ list: WorkspaceApproval[]; error?: string }>(
    approvalsResult,
    { list: [] },
    "getOpenApprovalsForWorkspace",
  ).list;
  const clientRequests = unwrap<{ list: TeamClientRequest[]; error?: string }>(
    clientRequestsResult,
    { list: [] },
    "getWorkspaceClientRequests",
  ).list;
  const notifications = unwrap(
    notificationsResult,
    { list: [] as NotificationListItem[], unreadCount: 0 },
    "getNotificationsForWorkspace",
  );
  const qaReturns = unwrap<QaReturnItem[]>(qaReturnsResult, [], "getQaReturns");
  const activeTimer = unwrap<ActiveTimer | null>(
    activeTimerResult,
    null,
    "getActiveTimer",
  );
  const timeEntriesToday = unwrap(
    timeEntriesTodayResult,
    [],
    "getPersonTimeEntriesInRange",
  );
  const calendarBlocks = unwrap<CalendarBlock[]>(
    calendarBlocksResult,
    [],
    "getCalendarBlocks",
  );
  const myProjects = unwrap<MyProjectProgress[]>(
    myProjectsResult,
    [],
    "getMyProjectsProgress",
  );
  const overdueCur = unwrap(
    overdueCurResult,
    { data: 0, error: null },
    "getOverdueCount",
  );
  const overdueDelta = unwrap(overdueDeltaResult, 0, "getKpiDelta(overdue)");
  const completedCur = unwrap(
    completedCurResult,
    { data: 0, error: null },
    "getCompletedCount",
  );
  const completedDelta = unwrap(
    completedDeltaResult,
    0,
    "getKpiDelta(completed)",
  );
  const unassignedCount = unwrap(unassignedResult, 0, "getUnassignedCount");
  const workload = unwrap(
    workloadResult,
    [],
    "getWorkspaceTimeByPerson",
  );
  const members = unwrap(
    membersResult,
    { active: [], pending: [] },
    "getWorkspaceMembers",
  );
  const personalTodos = unwrap(personalTodosResult, [], "getPersonalTodos");

  const userName =
    people.get(userId)?.name ?? user.email?.split("@")[0] ?? "there";

  // --- AttentionItem assembly ---
  const attentionItems: AttentionItem[] = [];

  for (const approval of approvals) {
    attentionItems.push({
      id: `approval-${approval.id}`,
      kind: "approval",
      title: approval.blocks?.label ?? "An approval request",
      subtitle: `${approval.projectName} · requested ${new Date(approval.requestedAt).toLocaleDateString()}`,
      actionLabel: "Review",
      actionHref: `/w/${workspaceSlug}/inbox?tab=approvals`,
      _date: approval.requestedAt,
    } as AttentionItem & { _date: string });
  }

  if (resolvedRole !== "member") {
    for (const request of clientRequests) {
      if (request.status !== "submitted" && request.status !== "in_review") {
        continue;
      }
      attentionItems.push({
        id: `client-request-${request.id}`,
        kind: "client_request",
        title: request.title,
        subtitle: `${request.projectName} · ${request.requesterName ?? "A client"}`,
        actionLabel: "Triage",
        actionHref: `/w/${workspaceSlug}/inbox?tab=requests`,
        _date: request.createdAt,
      } as AttentionItem & { _date: string });
    }
  }

  for (const notification of notifications.list) {
    if (
      (notification.kind !== "mention" && notification.kind !== "comment_reply") ||
      notification.readAt !== null
    ) {
      continue;
    }
    attentionItems.push({
      id: `mention-${notification.id}`,
      kind: "mention",
      title: notification.task?.title ?? "A mention",
      subtitle: notification.task?.key ?? "",
      actionLabel: "View",
      actionHref: `/w/${workspaceSlug}/inbox?tab=notifications`,
      _date: notification.createdAt,
    } as AttentionItem & { _date: string });
  }

  for (const qaReturn of qaReturns) {
    attentionItems.push({
      id: `qa-return-${qaReturn.taskId}`,
      kind: "qa_return",
      title: qaReturn.taskTitle,
      subtitle: `${qaReturn.projectName} · sent back`,
      actionLabel: "View",
      actionHref: `/w/${workspaceSlug}/my-tasks`,
      _date: qaReturn.changedAt,
    } as AttentionItem & { _date: string });
  }

  const totalAttentionCount = attentionItems.length;
  const sortedAttentionItems = attentionItems
    .sort((a, b) => {
      const aDate = (a as AttentionItem & { _date: string })._date;
      const bDate = (b as AttentionItem & { _date: string })._date;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    })
    .slice(0, 10)
    .map(({ id, kind, title, subtitle, actionLabel, actionHref }) => ({
      id,
      kind,
      title,
      subtitle,
      actionLabel,
      actionHref,
    }));

  // --- MyWorkCard: done-status name per project ---
  const projectIdsInMyWork = new Set<string>();
  for (const row of [...myTasks.overdue, ...myTasks.today, ...myTasks.thisWeek]) {
    projectIdsInMyWork.add(row.projectId);
  }

  const doneStatusIdByProject: Record<string, string> = {};
  if (projectIdsInMyWork.size > 0) {
    const { data: statusRows, error: statusError } = await supabase
      .from("project_statuses")
      .select("project_id, name, category")
      .in("project_id", Array.from(projectIdsInMyWork))
      .eq("category", "done");
    if (statusError) {
      logger.error(`[home-dashboard] project_statuses (done) lookup failed: ${statusError.message}`);
    } else {
      for (const row of statusRows ?? []) {
        if (!doneStatusIdByProject[row.project_id]) {
          doneStatusIdByProject[row.project_id] = row.name;
        }
      }
    }
  }

  // --- TodayTimeCard ---
  const todayMinutes = timeEntriesToday.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );

  // --- TeamHealthSection: workload members ---
  const nameByUserId = new Map(
    members.active.map((m) => [m.userId, { name: m.name, avatarUrl: m.avatarUrl }]),
  );
  const workloadMembers: WorkloadCardMember[] = workload.map((w) => ({
    userId: w.userId,
    displayName: nameByUserId.get(w.userId)?.name ?? "Unknown",
    avatarUrl: nameByUserId.get(w.userId)?.avatarUrl ?? null,
    minutesThisWeek: w.billableMinutes + w.nonBillableMinutes,
  }));

  const overdueCount = overdueCur.data ?? 0;
  const completedCount = completedCur.data ?? 0;
  const todayTaskCount = myTasks.today.length;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <HomeGreeting
        userName={userName}
        timezone={timezone}
        attentionCount={totalAttentionCount}
        todayTaskCount={todayTaskCount}
        overdueCount={overdueCount}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <NeedsYouCard
            items={sortedAttentionItems}
            totalCount={totalAttentionCount}
            role={resolvedRole}
            workspaceSlug={workspaceSlug}
          />
          <MyWorkCard
            overdue={myTasks.overdue}
            today={myTasks.today}
            thisWeek={myTasks.thisWeek}
            workspaceSlug={workspaceSlug}
            doneStatusIdByProject={doneStatusIdByProject}
            activeTimerTaskId={activeTimer?.taskId}
          />
          <MyProjectsGrid projects={myProjects} workspaceSlug={workspaceSlug} />
        </div>

        <div className="flex flex-col gap-6">
          <TodayTimeCard
            todayMinutes={todayMinutes}
            targetMinutes={TARGET_MINUTES_PER_DAY}
            activeTimer={activeTimer}
          />
          <PersonalTodoList
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            initialTodos={personalTodos}
          />
          <ComingUpCard blocks={calendarBlocks} workspaceSlug={workspaceSlug} />
        </div>
      </div>

      {/* TeamHealthSection self-gates to owner/admin, returning null for
          any other role — see components/dashboard/team-health-section.tsx. */}
      <TeamHealthSection
        overdueCount={overdueCount}
        overdueDelta={overdueDelta}
        unassignedCount={unassignedCount}
        completedCount={completedCount}
        completedDelta={completedDelta}
        workloadMembers={workloadMembers}
        workspaceSlug={workspaceSlug}
        role={resolvedRole}
      />
    </div>
  );
}
