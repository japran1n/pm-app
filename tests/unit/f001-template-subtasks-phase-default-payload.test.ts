// F001 (missions/20260921-clickup-website-template): validation-layer
// coverage for the three template extensions this feature adds:
// subtask hierarchy (`children`), phase-per-task (`phase`), and the
// `setDefaultTemplate` input schema. Pure Zod-parsing tests — no database
// round trip needed to prove a schema still parses.

import { describe, expect, it } from "vitest";

import {
  projectTemplatePayloadSchema,
  projectTemplateTaskSchema,
  setDefaultTemplateSchema,
} from "@/lib/validation/templates";

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    title: "Kickoff call",
    description: null,
    description_json: null,
    priority: null,
    checklistItems: [],
    estimate_minutes: null,
    tags: [],
    ...overrides,
  };
}

describe("F001: projectTemplateTaskSchema — subtask hierarchy (children)", () => {
  it("parses a task with no children key at all (backward compatibility with every existing template)", () => {
    const parsed = projectTemplateTaskSchema.safeParse(baseTask());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.children).toEqual([]);
    }
  });

  it("parses a task with one level of nested children, preserving order", () => {
    const parsed = projectTemplateTaskSchema.safeParse(
      baseTask({
        children: [baseTask({ title: "Subtask A" }), baseTask({ title: "Subtask B" })],
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.children).toHaveLength(2);
      expect(parsed.data.children[0].title).toBe("Subtask A");
      expect(parsed.data.children[1].title).toBe("Subtask B");
    }
  });

  it("parses a task with children nested up to the bounded depth (5 levels)", () => {
    let leaf = baseTask({ title: "Level 5" });
    for (let level = 4; level >= 1; level--) {
      leaf = baseTask({ title: `Level ${level}`, children: [leaf] });
    }
    const parsed = projectTemplateTaskSchema.safeParse(leaf);
    expect(parsed.success).toBe(true);
  });

  it("rejects a task tree nested deeper than the bounded depth (6 levels)", () => {
    let leaf = baseTask({ title: "Level 6" });
    for (let level = 5; level >= 1; level--) {
      leaf = baseTask({ title: `Level ${level}`, children: [leaf] });
    }
    const parsed = projectTemplateTaskSchema.safeParse(leaf);
    expect(parsed.success).toBe(false);
  });
});

describe("F001: projectTemplateTaskSchema — phase-per-task", () => {
  it("parses a task with no phase key at all (backward compatibility)", () => {
    const parsed = projectTemplateTaskSchema.safeParse(baseTask());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phase).toBeUndefined();
    }
  });

  it("parses a task with a phase name", () => {
    const parsed = projectTemplateTaskSchema.safeParse(baseTask({ phase: "Design" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phase).toBe("Design");
    }
  });

  it("rejects an empty-string phase name", () => {
    const parsed = projectTemplateTaskSchema.safeParse(baseTask({ phase: "" }));
    expect(parsed.success).toBe(false);
  });
});

describe("F001: projectTemplatePayloadSchema — full payload with hierarchy + phases", () => {
  it("parses a payload saved before this feature (flat tasks, no children/phase keys) unchanged", () => {
    const legacyPayload = {
      tasks: [baseTask()],
      phases: [],
    };
    const parsed = projectTemplatePayloadSchema.safeParse(legacyPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tasks).toHaveLength(1);
      expect(parsed.data.tasks[0].children).toEqual([]);
    }
  });

  it("parses a payload with a task carrying both children and a phase name matching phases[]", () => {
    const payload = {
      tasks: [
        baseTask({
          title: "Design review",
          phase: "Design",
          children: [baseTask({ title: "Gather feedback" })],
        }),
      ],
      phases: [{ name: "Design", client_description: null, client_visible: true }],
    };
    const parsed = projectTemplatePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tasks[0].phase).toBe("Design");
      expect(parsed.data.tasks[0].children).toHaveLength(1);
    }
  });
});

describe("F001: setDefaultTemplateSchema", () => {
  it("accepts a valid workspaceId with a templateId to set as default", () => {
    const parsed = setDefaultTemplateSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      templateId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a null templateId to clear the default", () => {
    const parsed = setDefaultTemplateSchema.safeParse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      templateId: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.templateId).toBeNull();
    }
  });

  it("rejects a non-uuid workspaceId", () => {
    const parsed = setDefaultTemplateSchema.safeParse({
      workspaceId: "not-a-uuid",
      templateId: null,
    });
    expect(parsed.success).toBe(false);
  });
});
