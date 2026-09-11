import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// F070 (AS-168): "The brief's revision history is presented separately from
// the project's general activity feed." Revision history (F067's
// RevisionHistory component) is rendered inline inside
// team-answers-view.tsx as a local expand/collapse toggle, fed by data the
// server page already fetched via getBriefWithRevisions -- it is never
// published into task_activity (F196's activity feed table/query) or any
// other general-activity source. These assertions verify that isolation
// stays true at the source level: no activity-feed kind vocabulary or
// query references `brief_answer_revisions`, and RevisionHistory itself
// contains no feed-writing/reading logic.

const ROOT = path.resolve(__dirname, "../..");

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("F070: AS-168 revision history is isolated from the general activity feed", () => {
  it("the task activity feed's kind vocabulary does not include a brief-revision kind", () => {
    const src = read("lib/activity/task-activity-feed.ts");
    const kindMatch = src.match(/export type TaskActivityKind\s*=\s*([^;]+);/);
    expect(kindMatch).not.toBeNull();
    const kindUnion = kindMatch![1];
    expect(kindUnion).not.toMatch(/brief/i);
    expect(kindUnion).not.toMatch(/revision/i);
  });

  it("the task activity feed query does not read from brief_answer_revisions", () => {
    const src = read("lib/queries/task-activity.ts");
    expect(src).not.toMatch(/brief_answer_revisions/);
  });

  it("no activity/audit feed query file references brief_answer_revisions", () => {
    const queriesDir = path.join(ROOT, "lib/queries");
    const files = readdirSync(queriesDir).filter((f) => f.endsWith(".ts"));
    const activityRelatedFiles = files.filter((f) => /activity|audit|watching/i.test(f));
    expect(activityRelatedFiles.length).toBeGreaterThan(0);

    for (const file of activityRelatedFiles) {
      const src = read(path.join("lib/queries", file));
      expect(src).not.toMatch(/brief_answer_revisions/);
    }
  });

  it("RevisionHistory (the brief revision UI) is a local component with no feed read/write", () => {
    const src = read("components/brief/revision-history.tsx");

    // Rendered inline via local useState toggle, not routed through any
    // activity/audit table or API call.
    expect(src).toMatch(/useState/);
    expect(src).not.toMatch(/task_activity/);
    expect(src).not.toMatch(/activity_feed/i);
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/fetch\(/);
  });

  it("RevisionHistory is composed inline inside the brief team-answers view, not inside an activity feed component", () => {
    const teamAnswersSrc = read("components/brief/team-answers-view.tsx");
    expect(teamAnswersSrc).toMatch(/RevisionHistory/);

    const activityFeedSrc = read("components/task/activity-feed.tsx");
    expect(activityFeedSrc).not.toMatch(/RevisionHistory/);
    expect(activityFeedSrc).not.toMatch(/brief_answer_revisions/);
    expect(activityFeedSrc).not.toMatch(/BriefAnswerRevision/);
  });
});
