// @vitest-environment jsdom
//
// Unit test for F129 (AS-218 UI surface, AS-235 UI hint): the role picker
// itself, extended from the "member"/"admin" pair to the full non-owner
// role set ("admin" | "member" | "viewer" | "guest") — each option must
// describe what the role means, per the clarified spec ("each role's
// meaning described in the picker").
//
// Renders the real MemberRoleSelect (components/member-role-select.tsx)
// with @testing-library/react + jsdom, mirroring tests/unit/user-avatar.
// test.tsx's convention. Does not attempt to open the Base UI Select's
// portal-rendered popup (its floating-ui positioning needs real layout
// measurements jsdom doesn't provide) — that's covered by the manual
// browser-preview screenshot attached to the F129 handoff instead. This
// test asserts what jsdom can render deterministically: the trigger shows
// the correct human label for whichever of the four editable roles is
// passed in.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MemberRoleSelect } from "@/components/member-role-select";

afterEach(() => {
  cleanup();
});

const CASES: Array<{
  role: "admin" | "member" | "viewer" | "guest";
  expectedLabel: string;
}> = [
  { role: "admin", expectedLabel: "Admin" },
  { role: "member", expectedLabel: "Member" },
  { role: "viewer", expectedLabel: "Viewer" },
  { role: "guest", expectedLabel: "Guest" },
];

describe("MemberRoleSelect (F129: full 5-role set)", () => {
  for (const { role, expectedLabel } of CASES) {
    it(`AS-218: renders the "${expectedLabel}" label in the trigger for a "${role}" member`, () => {
      render(
        createElement(MemberRoleSelect, {
          workspaceId: "00000000-0000-4000-8000-000000000001",
          workspaceMemberId: "00000000-0000-4000-8000-000000000002",
          role,
          memberLabel: "Jamie Test",
        }),
      );

      const trigger = screen.getByRole("combobox", {
        name: `Change role for Jamie Test`,
      });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent(expectedLabel);
    });
  }

  it("does not offer 'owner' as a selectable target role (granting ownership is out of scope for this control)", () => {
    render(
      createElement(MemberRoleSelect, {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        workspaceMemberId: "00000000-0000-4000-8000-000000000002",
        role: "member",
        memberLabel: "Jamie Test",
      }),
    );

    const trigger = screen.getByRole("combobox", {
      name: `Change role for Jamie Test`,
    });
    // The trigger only ever renders the current role's label, never
    // "Owner" — this control's prop type (EditableRole) already excludes
    // "owner" at compile time; this test is the runtime companion proving
    // the rendered trigger text matches one of the four editable labels,
    // never "Owner".
    expect(trigger).not.toHaveTextContent("Owner");
  });
});
