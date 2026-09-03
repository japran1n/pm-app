// F013 (missions/20260903-portal, M3): backward compatibility for
// `projectTemplatePayloadSchema`'s new `deliverables` field (AS-028's
// Definition of done: "creating a project from an existing template that
// has no deliverables[] section still works"). A pure Zod-parsing test —
// no database round trip needed to prove a schema still parses old data.

import { describe, expect, it } from "vitest";

import {
  projectTemplatePayloadSchema,
  projectTemplateDeliverableSchema,
} from "@/lib/validation/templates";

describe("F013: projectTemplatePayloadSchema backward compatibility", () => {
  it("parses a payload saved before this feature (no deliverables key at all) with deliverables defaulting to []", () => {
    const legacyPayload = {
      tasks: [
        {
          title: "Kickoff call",
          description: null,
          description_json: null,
          priority: null,
          checklistItems: [],
          estimate_minutes: null,
          tags: [],
        },
      ],
      phases: [],
      // No `deliverables` key — the exact shape a template saved before
      // F013 has in its stored `payload` jsonb column.
    };

    const parsed = projectTemplatePayloadSchema.safeParse(legacyPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deliverables).toEqual([]);
      expect(parsed.data.tasks).toHaveLength(1);
    }
  });

  it("parses a payload with a deliverables[] section (the new shape)", () => {
    const payload = {
      tasks: [],
      phases: [],
      deliverables: [
        {
          title: "Brand logo files",
          description: "Vector + PNG, transparent background.",
          kind: "image",
          owner_name: "Client marketing lead",
          blocking: true,
          due_offset_days: 3,
        },
      ],
    };

    const parsed = projectTemplatePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deliverables).toHaveLength(1);
      expect(parsed.data.deliverables[0].kind).toBe("image");
      expect(parsed.data.deliverables[0].due_offset_days).toBe(3);
    }
  });

  it("a single deliverable entry defaults blocking to false and due_offset_days to null when omitted", () => {
    const parsed = projectTemplateDeliverableSchema.safeParse({
      title: "Sitemap approval",
      description: null,
      kind: "decision",
      owner_name: "Client",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.blocking).toBe(false);
      expect(parsed.data.due_offset_days).toBeNull();
    }
  });

  it("rejects a deliverable entry with an empty title", () => {
    const parsed = projectTemplateDeliverableSchema.safeParse({
      title: "   ",
      description: null,
      kind: "other",
      owner_name: "Client",
    });

    expect(parsed.success).toBe(false);
  });
});
