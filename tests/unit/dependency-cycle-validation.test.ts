// Unit test for F156's createDependencySchema (AS-278). This is the only
// pure-logic piece of this feature — the actual cycle detection is a
// database-level, transaction-scoped concern (a recursive CTE behind an
// advisory lock, see
// supabase/migrations/20260819103337_dependency_cycle_guard.sql) and
// deliberately has no TypeScript counterpart: any "path-finding" reimplemented
// in application code would be a second source of truth at best, and a
// reintroduction of the exact TOCTOU race this feature exists to close at
// worst. What IS pure logic — and unit-testable — is the not-self input
// guard, which is safe to check client-side because it needs no other rows.
// The actual cycle-rejection behaviour (including the concurrency
// guarantee) is covered by the integration test,
// tests/integration/dependency-cycle.test.ts, against the real database.

import { describe, expect, it } from "vitest";

import { createDependencySchema } from "@/lib/validation/dependencies";

const taskAId = "11111111-1111-4111-8111-111111111111";
const taskBId = "22222222-2222-4222-8222-222222222222";

describe("createDependencySchema", () => {
  it("accepts two distinct, well-formed task ids", () => {
    const result = createDependencySchema.safeParse({
      blockingTaskId: taskAId,
      blockedTaskId: taskBId,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a task depending on itself (AS-279's client-side mirror)", () => {
    const result = createDependencySchema.safeParse({
      blockingTaskId: taskAId,
      blockedTaskId: taskAId,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "A task cannot depend on itself.",
      );
    }
  });

  it("rejects an invalid blockingTaskId", () => {
    const result = createDependencySchema.safeParse({
      blockingTaskId: "not-a-uuid",
      blockedTaskId: taskBId,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid blockedTaskId", () => {
    const result = createDependencySchema.safeParse({
      blockingTaskId: taskAId,
      blockedTaskId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = createDependencySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
