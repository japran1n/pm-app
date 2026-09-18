// F084 (missions/20260903-portal): unit coverage for
// lib/notifications/portal-recipients.ts's `getPortalEventRecipients` --
// the recipient rule three new portal fan-out call sites
// (lib/actions/portal-approval.ts, lib/actions/client-requests.ts,
// lib/actions/portal-deliverables.ts) all share.
//
// P2-22: `getPortalEventRecipients` now re-checks every candidate id
// (decision owner or task assignee) against `workspace_members` and only
// keeps staff roles (owner/admin/member, active) -- a decision owner or
// assignee can be a `guest` (a project-scoped guest still counts as a
// project "writer"), and a client must never receive its own request's
// team-facing notification. `makeAdmin` grows two more tables
// (`projects`, `workspace_members`) to back that lookup.

import { describe, expect, it } from "vitest";
import { getPortalEventRecipients } from "@/lib/notifications/portal-recipients";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "77777777-7777-4777-8777-777777777777";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "33333333-3333-4333-8333-333333333333";
const OWNER_B = "44444444-4444-4444-8444-444444444444";
const ASSIGNEE = "55555555-5555-4555-8555-555555555555";
const CLIENT = "66666666-6666-4666-8666-666666666666";
const GUEST = "88888888-8888-4888-8888-888888888888";

function makeAdmin(opts: {
  owners: { user_id: string }[];
  assigneeId: string | null;
  staff?: { user_id: string }[];
}) {
  // Defaults every candidate id to a staff role unless the test overrides
  // `staff` -- keeps the pre-existing tests below (written before P2-22)
  // exercising the decision-owner/assignee logic without also having to
  // restate "and these are all staff" every time.
  const staff = opts.staff ?? [
    { user_id: OWNER_A },
    { user_id: OWNER_B },
    { user_id: ASSIGNEE },
  ];
  return {
    from: (table: string) => {
      if (table === "project_decision_owners") {
        return {
          select: () => ({
            eq: async () => ({ data: opts.owners, error: null }),
          }),
        };
      }
      if (table === "tasks") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { assignee_id: opts.assigneeId },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { workspace_id: WORKSPACE_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "workspace_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  in: async () => ({ data: staff, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getPortalEventRecipients (F084)", () => {
  it("test_F084_returns_every_decision_owner_plus_the_task_assignee", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: OWNER_A }, { user_id: OWNER_B }],
      assigneeId: ASSIGNEE,
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      excludeUserId: CLIENT,
    });
    expect(new Set(result)).toEqual(new Set([OWNER_A, OWNER_B, ASSIGNEE]));
  });

  it("test_F084_dedupes_a_decision_owner_who_is_also_the_assignee", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: OWNER_A }],
      assigneeId: OWNER_A,
      staff: [{ user_id: OWNER_A }],
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      excludeUserId: CLIENT,
    });
    expect(result).toEqual([OWNER_A]);
  });

  it("test_F084_never_includes_the_excluded_actor_even_as_a_decision_owner_or_assignee", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: CLIENT }, { user_id: OWNER_A }],
      assigneeId: CLIENT,
      staff: [{ user_id: OWNER_A }],
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      excludeUserId: CLIENT,
    });
    expect(result).toEqual([OWNER_A]);
  });

  it("test_F084_no_task_id_means_no_assignee_lookup_at_all", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: OWNER_A }],
      assigneeId: ASSIGNEE,
      staff: [{ user_id: OWNER_A }],
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      excludeUserId: CLIENT,
    });
    expect(result).toEqual([OWNER_A]);
  });

  it("test_F084_no_owners_and_no_task_returns_an_empty_array", async () => {
    const admin = makeAdmin({ owners: [], assigneeId: null });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      excludeUserId: CLIENT,
    });
    expect(result).toEqual([]);
  });

  // P2-22: the actual defect this fix closes -- a decision owner (or
  // assignee) who is a `guest`, not a client/team role, must never be
  // notified. `is_project_workspace_writer` lets a project-scoped guest
  // hold a `project_decision_owners` row, so this is a real, reachable
  // shape, not a hypothetical one.
  it("test_P2_22_excludes_a_decision_owner_who_is_a_guest_not_staff", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: OWNER_A }, { user_id: GUEST }],
      assigneeId: null,
      staff: [{ user_id: OWNER_A }],
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      excludeUserId: CLIENT,
    });
    expect(result).toEqual([OWNER_A]);
  });

  // P2-22: belt-and-suspenders -- even if a client id somehow reached
  // this far (e.g. as a task assignee), the staff-role re-check must
  // still strip it out.
  it("test_P2_22_excludes_a_task_assignee_who_is_a_client", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: OWNER_A }],
      assigneeId: CLIENT,
      staff: [{ user_id: OWNER_A }],
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      excludeUserId: "someone-else",
    });
    expect(result).toEqual([OWNER_A]);
  });

  it("test_P2_22_no_staff_among_the_candidates_returns_an_empty_array", async () => {
    const admin = makeAdmin({
      owners: [{ user_id: GUEST }],
      assigneeId: CLIENT,
      staff: [],
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      excludeUserId: "someone-else",
    });
    expect(result).toEqual([]);
  });
});
