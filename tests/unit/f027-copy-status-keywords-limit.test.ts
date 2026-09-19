// Mission 20260919-150607, F027 (AS-095, AS-096): validation for the
// section copy-brief fields carried by `architecture_node_meta` --
// `keywords` is bounded to 30 entries, and `copy_status` only accepts the
// five known enum values. Both constraints are enforced by
// `setNodeMetaSchema` (lib/validation/architecture.ts), which mirrors the
// DB CHECK constraints in
// supabase/migrations/20261127021000_architecture_node_meta.sql
// (`architecture_node_meta_keywords_bounded` and the `copy_status` check).

import { describe, expect, it } from "vitest";

import { setNodeMetaSchema, copyStatusSchema } from "@/lib/validation/architecture";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function makeKeywords(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `keyword-${i}`);
}

describe("AS-095: 30-keyword limit on node meta (sections)", () => {
  it("accepts exactly 30 keywords", () => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { keywords: makeKeywords(30) },
    });
    expect(result.success).toBe(true);
  });

  it("rejects 31 keywords with a validation error", () => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { keywords: makeKeywords(31) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a large paste-bomb of keywords well beyond 30", () => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { keywords: makeKeywords(100) },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty keywords array", () => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { keywords: [] },
    });
    expect(result.success).toBe(true);
  });
});

describe("AS-096: copy_status enum validation", () => {
  const validStatuses = [
    "not_started",
    "brief_ready",
    "drafted",
    "in_review",
    "approved",
  ] as const;

  it.each(validStatuses)("accepts copyStatus = %s", (status) => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { copyStatus: status },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid copy_status value", () => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { copyStatus: "done" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid copy_status value directly against copyStatusSchema", () => {
    const result = copyStatusSchema.safeParse("pending");
    expect(result.success).toBe(false);
  });

  it("allows copyStatus to be omitted (partial patch)", () => {
    const result = setNodeMetaSchema.safeParse({
      taskId: TASK_ID,
      patch: { intent: "Something" },
    });
    expect(result.success).toBe(true);
  });
});
