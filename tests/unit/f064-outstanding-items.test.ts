// F064 (AS-163, AS-164): outstanding-items integration for the brief
// questionnaire in the client's "waiting on you" list.
import { describe, it, expect } from "vitest";
import { buildWaitingOnYouItems } from "@/lib/portal/build-waiting-on-you-items";

const baseArgs = {
  approvals: [],
  tasks: [],
  deliverables: [],
  accounts: [],
  workspaceSlug: "acme",
  projectId: "project-1",
  todayIso: "2026-09-10",
};

describe("F064 outstanding-items integration", () => {
  it("AS-163: a draft brief with at least one question appears in the outstanding-items list", () => {
    const items = buildWaitingOnYouItems({
      ...baseArgs,
      brief: { state: "draft", questionCount: 3 },
    });

    const briefItem = items.find((item) => item.kind === "brief");
    expect(briefItem).toBeDefined();
    expect(briefItem?.title).toBe("Project questionnaire");
    expect(briefItem?.href).toBe("/portal/acme/p/project-1/brief");
  });

  it("AS-164: a submitted brief does not appear in the outstanding-items list", () => {
    const items = buildWaitingOnYouItems({
      ...baseArgs,
      brief: { state: "submitted", questionCount: 3 },
    });

    expect(items.find((item) => item.kind === "brief")).toBeUndefined();
  });

  it("AS-164: an approved brief does not appear in the outstanding-items list", () => {
    const items = buildWaitingOnYouItems({
      ...baseArgs,
      brief: { state: "approved", questionCount: 3 },
    });

    expect(items.find((item) => item.kind === "brief")).toBeUndefined();
  });

  it("a draft brief with no questions does not appear (nothing for the client to do)", () => {
    const items = buildWaitingOnYouItems({
      ...baseArgs,
      brief: { state: "draft", questionCount: 0 },
    });

    expect(items.find((item) => item.kind === "brief")).toBeUndefined();
  });

  it("no brief at all does not add a brief item", () => {
    const items = buildWaitingOnYouItems({
      ...baseArgs,
      brief: null,
    });

    expect(items.find((item) => item.kind === "brief")).toBeUndefined();
  });

  it("omitting brief entirely (optional param) does not add a brief item", () => {
    const items = buildWaitingOnYouItems({ ...baseArgs });

    expect(items.find((item) => item.kind === "brief")).toBeUndefined();
  });
});
