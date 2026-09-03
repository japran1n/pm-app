// F006 (missions/20260903-portal): unit coverage for the overview's new
// query functions (lib/queries/portal.ts), mocked the same way
// tests/unit/portal-phases-query.test.ts covers `getProjectPhases` --
// the RLS half of "a client cannot read this table" is a live-database
// fact this file doesn't re-prove; what's covered here is each
// function's own business logic (which real signal a count comes from,
// which rows get excluded, what an honest "not built yet" stub returns).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

// --- getPortalBadgeCounts (AS-002, AS-003) ---------------------------------
//
// F007 (missions/20260903-portal, M2): `getPortalBadgeCounts` now counts
// `approval_requests` rows in state 'pending' (the first-class table this
// feature introduced), not `tasks.pending_client_approval` — the mock
// below follows that same table/chain shape.

let approvalCountResult: { count: number | null; error: unknown };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "approval_requests") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => approvalCountResult),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

// --- getPortalLiveNow / getPortalTeam (admin client) -----------------------

let projectRow: Row | null;
let activeTimerRows: Row[];
let projectMemberRows: Row[];
let workspaceMemberRoleRows: Row[];
let phaseRows: Row[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: projectRow, error: null })),
            })),
          })),
        };
      }
      if (table === "active_timers") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({ data: activeTimerRows, error: null })),
            })),
          })),
        };
      }
      if (table === "project_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: projectMemberRows, error: null })),
          })),
        };
      }
      if (table === "workspace_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ data: workspaceMemberRoleRows, error: null })),
            })),
          })),
        };
      }
      if (table === "project_phases") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ data: phaseRows, error: null })),
            })),
          })),
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    }),
  })),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async (ids: string[]) => {
    const map = new Map<string, { name: string | null; email: string | null; avatarUrl: string | null }>();
    for (const id of ids) {
      map.set(id, { name: `Person ${id}`, email: null, avatarUrl: null });
    }
    return map;
  }),
}));

import {
  getPortalBadgeCounts,
  getPortalLiveNow,
  getPortalRisks,
  getPortalTeam,
} from "@/lib/queries/portal";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  projectRow = { id: PROJECT_ID, workspace_id: WORKSPACE_ID };
  activeTimerRows = [];
  projectMemberRows = [];
  workspaceMemberRoleRows = [];
  phaseRows = [];
});

describe("getPortalBadgeCounts — AS-002, AS-003", () => {
  it("test_AS_002_counts_pending_approval_requests_as_approvals_awaiting", async () => {
    approvalCountResult = { count: 3, error: null };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toBe(3);
  });

  it("test_AS_002_a_project_with_nothing_pending_reports_zero_not_an_error", async () => {
    approvalCountResult = { count: 0, error: null };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toBe(0);
  });

  it("test_AS_003_deliverables_past_due_is_honestly_zero_until_the_deliverables_table_exists", async () => {
    approvalCountResult = { count: 5, error: null };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    // Not fabricated -- there is no deliverables entity in this schema
    // yet (F012, M3), so zero deliverables can be past due.
    expect(badges.deliverablesPastDue).toBe(0);
  });

  it("returns zero rather than throwing when the count query errors", async () => {
    approvalCountResult = { count: null, error: { message: "boom" } };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toBe(0);
  });
});

describe("getPortalRisks — AS-031 (ships now, wired in M3)", () => {
  it("test_AS_031_returns_an_empty_list_never_a_fabricated_risk", async () => {
    const risks = await getPortalRisks(PROJECT_ID);
    expect(risks).toEqual([]);
  });
});

describe("getPortalLiveNow", () => {
  it("shows the task title for a client-visible task", async () => {
    activeTimerRows = [
      {
        id: "timer-1",
        user_id: "user-1",
        tasks: {
          id: "task-1",
          title: "Design the Services page",
          client_visible: true,
          phase_id: null,
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-1", role: "member" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("Design the Services page");
    expect(entries[0]!.personName).toBe("Person user-1");
  });

  it("falls back to the phase name, never the task name, when the task is not client-visible but the phase is", async () => {
    activeTimerRows = [
      {
        id: "timer-2",
        user_id: "user-2",
        tasks: {
          id: "task-2",
          title: "Internal QA sweep",
          client_visible: false,
          phase_id: "phase-1",
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-2", role: "member" }];
    // A client_visible=true phase -- this is what the real
    // `.eq("client_visible", true)` filter on the project_phases lookup
    // returns for a phase that passes it, so the row is present here.
    phaseRows = [{ id: "phase-1", name: "Izrada sajta" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("Izrada sajta");
    expect(entries[0]!.label).not.toContain("Internal QA sweep");
  });

  // F006b (missions/20260903-portal, AS-012): this is the exact fixture
  // the M1 scrutiny report's B2 named -- a task that is not client-visible
  // sitting inside a phase that is ALSO not client-visible. The old
  // fixture here had no `client_visible` field on the phase at all and
  // asserted the phase's NAME was shown, which is precisely the defect:
  // `getPortalLiveNow`'s `project_phases` lookup used to have no
  // `client_visible` filter, so a hidden phase's name reached the
  // client's overview. The real `.eq("client_visible", true)` filter this
  // feature adds means Postgres never returns a hidden phase's row at
  // all -- `phaseRows = []` is what that filtered-out row looks like from
  // this function's side, which is why the label falls all the way
  // through to the generic phrase rather than any name.
  it("test_AS_012_falls_back_to_a_generic_label_never_the_phase_name_when_the_phase_itself_is_not_client_visible", async () => {
    activeTimerRows = [
      {
        id: "timer-2b",
        user_id: "user-2b",
        tasks: {
          id: "task-2b",
          title: "Internal QA sweep",
          client_visible: false,
          phase_id: "phase-hidden",
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-2b", role: "member" }];
    // The hidden phase's row is absent -- exactly what
    // `.eq("client_visible", true)` produces for a `client_visible = false`
    // phase against a real database.
    phaseRows = [];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("Working on the project");
    expect(entries[0]!.label).not.toContain("Internal QA sweep");
    expect(entries[0]!.label).not.toContain("Rebuild after client rejected v1");
  });

  it("never carries a duration/elapsed-time field on any entry", async () => {
    activeTimerRows = [
      {
        id: "timer-3",
        user_id: "user-3",
        tasks: {
          id: "task-3",
          title: "Copy pass",
          client_visible: true,
          phase_id: null,
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-3", role: "member" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries[0]).not.toHaveProperty("startedAt");
    expect(entries[0]).not.toHaveProperty("duration");
  });

  it("excludes a timer belonging to a client member of the workspace", async () => {
    activeTimerRows = [
      {
        id: "timer-4",
        user_id: "client-user",
        tasks: {
          id: "task-4",
          title: "Should never show",
          client_visible: true,
          phase_id: null,
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "client-user", role: "client" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toEqual([]);
  });

  it("returns an empty list, not an error, when nobody is currently working", async () => {
    activeTimerRows = [];
    const entries = await getPortalLiveNow(PROJECT_ID);
    expect(entries).toEqual([]);
  });
});

describe("getPortalTeam", () => {
  it("returns an avatar-ready row per non-client project member, with a role label", async () => {
    projectMemberRows = [
      { user_id: "lead-1", project_role: "lead" },
      { user_id: "member-1", project_role: "member" },
    ];
    workspaceMemberRoleRows = [
      { user_id: "lead-1", role: "admin" },
      { user_id: "member-1", role: "member" },
    ];

    const team = await getPortalTeam(PROJECT_ID);

    expect(team).toHaveLength(2);
    const lead = team.find((m) => m.id === "lead-1")!;
    expect(lead.roleLabel).toBe("Project lead");
    const member = team.find((m) => m.id === "member-1")!;
    expect(member.roleLabel).toBe("Team member");
  });

  it("excludes a co-client's own project_members row from the team list", async () => {
    projectMemberRows = [
      { user_id: "client-1", project_role: "member" },
      { user_id: "member-1", project_role: "member" },
    ];
    workspaceMemberRoleRows = [
      { user_id: "client-1", role: "client" },
      { user_id: "member-1", role: "member" },
    ];

    const team = await getPortalTeam(PROJECT_ID);

    expect(team.map((m) => m.id)).toEqual(["member-1"]);
  });

  it("returns an empty list, not an error, when the project has no members yet", async () => {
    projectMemberRows = [];
    const team = await getPortalTeam(PROJECT_ID);
    expect(team).toEqual([]);
  });
});
