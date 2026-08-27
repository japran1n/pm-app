// @vitest-environment jsdom
//
// BUGFIX: components/task/list-assignee-cell.tsx nests <UserAvatarGroup>
// inside its own Popover trigger <button>. UserAvatarGroup's default
// rendering wraps each avatar in a Tooltip whose trigger is ALSO a real
// <button> — a <button> inside a <button> is invalid HTML, and React 19's
// hydration validator treats that as a hard, uncaught hydration failure
// that breaks ALL client interactivity on the page it occurs on (not
// merely a console warning). `interactive={false}` is the escape hatch:
// same avatars, same overflow chip, no per-avatar <button>.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UserAvatarGroup } from "@/components/user-avatar-group";
import type { UserAvatarPerson } from "@/components/user-avatar";

afterEach(() => {
  cleanup();
});

const PEOPLE: UserAvatarPerson[] = [
  { id: "u1", name: "Ana Kovač", email: "ana@example.com" },
  { id: "u2", name: "Luka Petrović", email: "luka@example.com" },
  { id: "u3", name: "Maja Ilić", email: "maja@example.com" },
  { id: "u4", name: "Saša Japranin", email: "sasa@example.com" },
];

describe("UserAvatarGroup interactive prop", () => {
  it("test_interactive_false_renders_zero_button_elements_safe_to_nest_in_another_button", () => {
    const { container } = render(
      <UserAvatarGroup people={PEOPLE} interactive={false} />,
    );

    expect(container.querySelectorAll("button")).toHaveLength(0);
    // Still shows every avatar's image/fallback and the overflow chip —
    // interactive=false removes the per-avatar button/tooltip, not the
    // information itself.
    expect(screen.getByTestId("avatar-group-overflow").textContent).toBe("+1");
  });

  it("test_interactive_true_default_is_unchanged_still_a_real_focusable_button_per_avatar", () => {
    const { container } = render(<UserAvatarGroup people={PEOPLE} />);

    // 3 visible avatars + 1 overflow chip, matching AVATAR_GROUP_LIMIT.
    expect(container.querySelectorAll("button")).toHaveLength(4);
  });

  it("test_a_group_with_interactive_false_produces_no_button_when_mounted_inside_another_button", () => {
    // The exact real-world shape that crashed hydration: UserAvatarGroup
    // nested inside another native <button>.
    const { container } = render(
      <button type="button">
        <UserAvatarGroup people={PEOPLE} interactive={false} />
      </button>,
    );

    // Exactly the outer button — zero nested ones.
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
