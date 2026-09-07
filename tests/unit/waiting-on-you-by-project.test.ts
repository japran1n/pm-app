import { describe, expect, it } from "vitest";

import { countWaitingOnYouByProject } from "@/lib/portal/waiting-on-you-by-project";

describe("countWaitingOnYouByProject", () => {
  it("counts zero for an empty list", () => {
    const counts = countWaitingOnYouByProject([]);
    expect(counts.size).toBe(0);
  });

  it("groups a single project's tasks under that project's id", () => {
    const counts = countWaitingOnYouByProject([
      { projectId: "p1" },
      { projectId: "p1" },
    ]);
    expect(counts.get("p1")).toBe(2);
  });

  it("keeps counts for different projects independent of each other", () => {
    const counts = countWaitingOnYouByProject([
      { projectId: "p1" },
      { projectId: "p2" },
      { projectId: "p1" },
      { projectId: "p3" },
    ]);
    expect(counts.get("p1")).toBe(2);
    expect(counts.get("p2")).toBe(1);
    expect(counts.get("p3")).toBe(1);
  });

  it("does not create an entry for a project with no waiting tasks", () => {
    const counts = countWaitingOnYouByProject([{ projectId: "p1" }]);
    expect(counts.has("p2")).toBe(false);
    expect(counts.get("p2")).toBeUndefined();
  });
});
