// Mission 20260919-150607, F002 (AS-010..AS-014): changeSectionKindSchema
// validates `tasks.section_kind` changes with values derived from the DB
// CHECK constraint (tasks_section_kind_check: 'static', 'cms'), not
// hand-written per caller.

import { describe, expect, it } from "vitest";
import {
  changeSectionKindSchema,
  sectionKindEnum,
} from "@/lib/validation/architecture";

describe("F002 changeSectionKindSchema", () => {
  it("AS-010: changeSectionKindSchema exists and is exported", () => {
    expect(changeSectionKindSchema).toBeDefined();
    expect(typeof changeSectionKindSchema.parse).toBe("function");
  });

  it("AS-011: kind field is a Zod enum, not a plain string", () => {
    // z.enum schemas expose an `options` array with the allowed literals.
    expect(Array.isArray(sectionKindEnum.options)).toBe(true);
    const shape = changeSectionKindSchema.shape;
    expect(shape.kind).toBe(sectionKindEnum);
    expect((shape.kind as { options?: unknown }).options).toBeDefined();
  });

  it("AS-012: valid values match the DB CHECK constraint exactly", () => {
    // supabase/migrations/20261124010000_..._section_kind.sql:
    // check (section_kind in ('static', 'cms'))
    expect(sectionKindEnum.options).toEqual(["static", "cms"]);
  });

  it("AS-012: accepts each value the CHECK constraint allows", () => {
    for (const kind of ["static", "cms"] as const) {
      const result = changeSectionKindSchema.safeParse({
        taskId: "11111111-1111-4111-8111-111111111111",
        kind,
      });
      expect(result.success).toBe(true);
    }
  });

  it("AS-013: schema rejects unknown kind values at parse time", () => {
    const result = changeSectionKindSchema.safeParse({
      taskId: "11111111-1111-4111-8111-111111111111",
      kind: "utility",
    });
    expect(result.success).toBe(false);
  });

  it("AS-013: schema rejects an empty/missing kind", () => {
    const result = changeSectionKindSchema.safeParse({
      taskId: "11111111-1111-4111-8111-111111111111",
      kind: "",
    });
    expect(result.success).toBe(false);
  });

  it("AS-013: schema rejects an invalid taskId", () => {
    const result = changeSectionKindSchema.safeParse({
      taskId: "not-a-uuid",
      kind: "static",
    });
    expect(result.success).toBe(false);
  });

  it("AS-014: schema is exported from the validation module (barrel)", async () => {
    const mod = await import("@/lib/validation/architecture");
    expect(mod.changeSectionKindSchema).toBe(changeSectionKindSchema);
  });
});
