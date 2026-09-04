// F084 (missions/20260903-portal): unit coverage for
// lib/notifications/portal-recipients.ts's `getPortalEventRecipients` --
// the recipient rule three new portal fan-out call sites
// (lib/actions/portal-approval.ts, lib/actions/client-requests.ts,
// lib/actions/portal-deliverables.ts) all share.

import { describe, expect, it } from "vitest";
import { getPortalEventRecipients } from "@/lib/notifications/portal-recipients";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "33333333-3333-4333-8333-333333333333";
const OWNER_B = "44444444-4444-4444-8444-444444444444";
const ASSIGNEE = "55555555-5555-4555-8555-555555555555";
const CLIENT = "66666666-6666-4666-8666-666666666666";

function makeAdmin(opts: {
  owners: { user_id: string }[];
  assigneeId: string | null;
}) {
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
    });
    const result = await getPortalEventRecipients(admin, {
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      excludeUserId: CLIENT,
    });
    expect(result).toEqual([OWNER_A]);
  });

  it("test_F084_no_task_id_means_no_assignee_lookup_at_all", async () => {
    const admin = makeAdmin({ owners: [{ user_id: OWNER_A }], assigneeId: ASSIGNEE });
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
});
