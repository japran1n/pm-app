import { describe, expect, it } from "vitest";

// F034 (AS-117, AS-118): setNodeMetaClientVisibility was removed as a
// standalone client-visibility toggle for node meta rows. This test asserts
// it no longer exists on the actions barrel or the node-meta module, and
// that its dedicated validation schema is gone.
describe("F034: setNodeMetaClientVisibility removal", () => {
  it("AS-117: is not exported from the node-meta actions module", async () => {
    const mod = await import("@/lib/actions/architecture/node-meta");
    expect((mod as Record<string, unknown>).setNodeMetaClientVisibility).toBeUndefined();
  });

  it("AS-117: is not exported from the architecture actions barrel", async () => {
    const mod = await import("@/lib/actions/architecture");
    expect((mod as Record<string, unknown>).setNodeMetaClientVisibility).toBeUndefined();
  });

  it("AS-117: its validation schema is not exported from lib/validation/architecture", async () => {
    const mod = await import("@/lib/validation/architecture");
    expect((mod as Record<string, unknown>).setNodeMetaClientVisibilitySchema).toBeUndefined();
  });
});
