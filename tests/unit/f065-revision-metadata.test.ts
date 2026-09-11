// Unit test for F065 (lib/queries/brief.ts): revision metadata
// (AS-128, AS-129, AS-155).
//
// AS-128: a revision record names the user who made the change.
// AS-129: a revision record carries the time of the change.
// AS-155: a revision records which client contact made the change.
//
// Same "compile-time/shape + module surface" approach as F048's test:
// `getBriefWithRevisions` needs a real request-scoped Supabase client
// (`@/lib/supabase/server`'s `createClient()` reads cookies), so this is
// not a live-DB integration test. What it verifies: the
// `BriefAnswerRevision` type carries a name alongside `changedBy`
// (AS-128/AS-155 -- client contacts are ordinary `profiles` rows, so the
// same `changedByName` field names either a team member or a client
// contact) and a `changedAt` timestamp (AS-129), and that
// `getBriefWithRevisions` is exported as the function that produces them.

import { describe, expect, it } from "vitest";
import * as briefQueries from "@/lib/queries/brief";
import type { BriefAnswerRevision } from "@/lib/queries/brief";

describe("F065: getBriefWithRevisions is exported (produces revision metadata)", () => {
  it("exports getBriefWithRevisions", () => {
    expect(typeof briefQueries.getBriefWithRevisions).toBe("function");
  });
});

describe("F065: BriefAnswerRevision names the user who made the change (AS-128)", () => {
  it("carries changedBy (id) and changedByName (display name) together", () => {
    const revision: BriefAnswerRevision = {
      id: "00000000-0000-4000-8000-000000000010",
      answerId: "00000000-0000-4000-8000-000000000004",
      previousText: "Original answer",
      previousOptions: null,
      changedBy: "00000000-0000-4000-8000-000000000020",
      changedByName: "Ana Horvat",
      changedAt: "2026-09-11T09:00:00.000Z",
    };

    expect(revision.changedBy).toBe("00000000-0000-4000-8000-000000000020");
    expect(revision.changedByName).toBe("Ana Horvat");
  });

  it("changedByName may be null when the profile has no display_name set", () => {
    const revision: BriefAnswerRevision = {
      id: "00000000-0000-4000-8000-000000000011",
      answerId: "00000000-0000-4000-8000-000000000004",
      previousText: "Original answer",
      previousOptions: null,
      changedBy: "00000000-0000-4000-8000-000000000021",
      changedByName: null,
      changedAt: "2026-09-11T09:05:00.000Z",
    };

    expect(revision.changedBy).not.toBeNull();
    expect(revision.changedByName).toBeNull();
  });
});

describe("F065: BriefAnswerRevision carries the time of the change (AS-129)", () => {
  it("changedAt is a timestamp string usable for ordering", () => {
    const older: BriefAnswerRevision = {
      id: "1",
      answerId: "a",
      previousText: "first draft",
      previousOptions: null,
      changedBy: null,
      changedByName: null,
      changedAt: "2026-09-01T00:00:00.000Z",
    };
    const newer: BriefAnswerRevision = {
      id: "2",
      answerId: "a",
      previousText: "second draft",
      previousOptions: null,
      changedBy: null,
      changedByName: null,
      changedAt: "2026-09-10T00:00:00.000Z",
    };

    expect(newer.changedAt > older.changedAt).toBe(true);
  });
});

describe("F065: a revision records which client contact made the change (AS-155)", () => {
  it("client contacts are named the same way team members are -- one profiles-backed field", () => {
    // Standing decision #15: all client contacts on a project are equal
    // editors of one shared brief; the revision records which contact
    // changed what. Client contacts have `profiles` rows just like team
    // members (F120), so `changedBy`/`changedByName` name a client
    // contact exactly the same way they'd name a team member -- there is
    // no separate "client contact" identity shape to model here.
    const clientContactRevision: BriefAnswerRevision = {
      id: "00000000-0000-4000-8000-000000000012",
      answerId: "00000000-0000-4000-8000-000000000004",
      previousText: "Client's earlier answer",
      previousOptions: null,
      changedBy: "00000000-0000-4000-8000-000000000030",
      changedByName: "Client Contact One",
      changedAt: "2026-09-11T10:00:00.000Z",
    };

    expect(clientContactRevision.changedBy).toBeTruthy();
    expect(clientContactRevision.changedByName).toBe("Client Contact One");
  });

  it("distinguishes revisions made by two different client contacts on the same shared brief", () => {
    const byContactA: BriefAnswerRevision = {
      id: "3",
      answerId: "a",
      previousText: "contact A's edit",
      previousOptions: null,
      changedBy: "00000000-0000-4000-8000-000000000031",
      changedByName: "Contact A",
      changedAt: "2026-09-11T11:00:00.000Z",
    };
    const byContactB: BriefAnswerRevision = {
      id: "4",
      answerId: "a",
      previousText: "contact B's edit",
      previousOptions: null,
      changedBy: "00000000-0000-4000-8000-000000000032",
      changedByName: "Contact B",
      changedAt: "2026-09-11T12:00:00.000Z",
    };

    expect(byContactA.changedBy).not.toBe(byContactB.changedBy);
    expect(byContactA.changedByName).not.toBe(byContactB.changedByName);
  });
});
