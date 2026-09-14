// Data-fetching for the client portal (C3/C4, docs/client-portal-plan.md).
//
// This file is a pure re-export barrel: the implementations live in the
// cohesive modules under lib/queries/portal/ (see lib/queries/portal/
// shared.ts's header for the RLS conventions the whole family follows).
// Every name exported here is exactly the public API the original
// single-file module exposed, so the ~60 importers of
// "@/lib/queries/portal" are unaffected by the split. Internal helpers
// (StatusRow, todayIso, the status-bucket map builder in
// lib/portal/status-bucket.ts) are deliberately NOT re-exported.

export type {
  StatusCategory,
  PortalLaunchConfidence,
  PortalBillingModel,
  PortalQueryResult,
} from "./portal/shared";

export {
  getPortalProjects,
  getPortalProjectOptions,
  type PortalTask,
  type PortalProject,
  type PortalProjectOption,
} from "./portal/projects";

export {
  getProjectPhases,
  type PortalPhaseState,
  type PortalPhase,
} from "./portal/phases";

export {
  getWorkspaceRoleForCurrentUser,
  getPortalCurrentUserProfile,
} from "./portal/user";

export {
  getPortalBadgeCounts,
  getPortalWaitingOnYouCount,
  getPortalRisks,
  type PortalBadgeCounts,
  type PortalRisk,
} from "./portal/badges";

export {
  getPortalLiveNow,
  getPortalTeam,
  type PortalLiveNowEntry,
  type PortalTeamMember,
} from "./portal/team";

export {
  getPortalRequests,
  type PortalRequest,
} from "./portal/requests";

export {
  getPortalTaskDetail,
  type PortalComment,
  type PortalTaskDetail,
} from "./portal/task-detail";

export {
  getPortalWaitingOnYou,
  getPortalOverview,
  getPortalActivitySummary,
  type PortalOverviewTask,
  type PortalOverview,
  type PortalActivitySummary,
} from "./portal/overview";

export {
  getPortalFiles,
  type PortalFile,
} from "./portal/files";

export {
  getPortalPages,
  type PortalPageStatus,
  type PortalPageAssignee,
  type PortalPage,
} from "./portal/pages";

export { getPortalWeeklyDelivery } from "./portal/delivery";
