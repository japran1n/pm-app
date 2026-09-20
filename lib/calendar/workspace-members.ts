// F087 (AS-052): a single pure helper that turns the raw
// `getWorkspaceMembers` result into exactly what the calendar page needs
// for the people switcher and the `?people=` allowlist -- so there is only
// ONE place that decides "pending invites never leak into either output",
// instead of two independent `.active.map(...)` call sites in page.tsx that
// a refactor could silently desync.

import type { ActiveMember, WorkspaceMembers } from "@/lib/queries/members";

export type SwitcherMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export function buildSwitcherMembers(
  workspaceMembers: Pick<WorkspaceMembers, "active"> & Partial<Pick<WorkspaceMembers, "pending">>,
): { switcherMembers: SwitcherMember[]; activeMemberIds: string[] } {
  // Only `.active` ever feeds either output -- `.pending` is accepted (so
  // callers can pass the full WorkspaceMembers shape without picking it
  // apart) but deliberately never read.
  const active: ActiveMember[] = workspaceMembers.active;

  return {
    switcherMembers: active.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      avatarUrl: m.avatarUrl,
    })),
    activeMemberIds: active.map((m) => m.userId),
  };
}
