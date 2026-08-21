// Unit tests for F141's single action-string -> human-readable sentence /
// target-link mapping (lib/queries/audit.ts). Exercises AS-246/AS-248's
// underlying requirement that the audit log render as readable sentences,
// not raw `action` keys — the assertions themselves are about read access
// and filterability, but the clarified spec's explicit Notes item
// ("Action strings must render as sentences, not raw keys") is asserted
// directly here so a regression that reintroduces a raw key leak is
// caught without needing a full page render.

import { describe, expect, it } from "vitest";
import {
  KNOWN_AUDIT_ACTIONS,
  actionSentence,
  targetHref,
} from "@/lib/queries/audit";

describe("actionSentence (F141)", () => {
  it("never renders the raw dotted action key verbatim as the whole sentence", () => {
    for (const action of KNOWN_AUDIT_ACTIONS) {
      const sentence = actionSentence({
        action,
        actorLabel: "Alice",
        metadata: {},
      });
      expect(sentence).not.toBe(action);
      expect(sentence).toContain("Alice");
    }
  });

  it("builds a readable sentence for a role change using metadata", () => {
    const sentence = actionSentence({
      action: "member.role_changed",
      actorLabel: "Alice",
      metadata: { old_role: "member", new_role: "admin" },
    });
    expect(sentence).toBe(
      "Alice changed a member's role from member to admin",
    );
  });

  it("builds a readable sentence for an invite using metadata", () => {
    const sentence = actionSentence({
      action: "member.invited",
      actorLabel: "Alice",
      metadata: { email: "bob@example.com", role: "member" },
    });
    expect(sentence).toBe("Alice invited bob@example.com as member");
  });

  it("falls back to a readable sentence for an unrecognised action rather than the raw key", () => {
    const sentence = actionSentence({
      action: "task.some_future_action",
      actorLabel: "Alice",
      metadata: {},
    });
    expect(sentence).toBe('Alice performed "task.some_future_action"');
  });
});

describe("targetHref (F141)", () => {
  it("links a project target to the project page", () => {
    expect(
      targetHref("acme", {
        targetType: "project",
        targetId: "proj-1",
        metadata: {},
      }),
    ).toBe("/w/acme/projects/proj-1");
  });

  it("links a workspace target to workspace settings", () => {
    expect(
      targetHref("acme", {
        targetType: "workspace",
        targetId: "ws-1",
        metadata: {},
      }),
    ).toBe("/w/acme/settings");
  });

  it("links a workspace_member target to the members page", () => {
    expect(
      targetHref("acme", {
        targetType: "workspace_member",
        targetId: "wm-1",
        metadata: {},
      }),
    ).toBe("/w/acme/settings/members");
  });

  it("links a project_member target via its metadata project_id", () => {
    expect(
      targetHref("acme", {
        targetType: "project_member",
        targetId: "pm-1",
        metadata: { project_id: "proj-2" },
      }),
    ).toBe("/w/acme/projects/proj-2");
  });

  it("returns null when there is nothing sensible to link to", () => {
    expect(
      targetHref("acme", {
        targetType: "project_member",
        targetId: "pm-1",
        metadata: {},
      }),
    ).toBeNull();
    expect(
      targetHref("acme", {
        targetType: "unknown_type",
        targetId: null,
        metadata: {},
      }),
    ).toBeNull();
  });
});
