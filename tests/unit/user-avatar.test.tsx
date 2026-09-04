// @vitest-environment jsdom
//
// F277: real DOM render tests for F122 (AS-214: "avatars appear on task
// cards, in the members list, on comments, and in assignee pickers") and
// AS-204 hardening (deterministic per-user colour, contrast).
//
// Replaces the source-text-grep verification in
// tests/unit/user-avatar-call-sites.test.ts as the primary evidence for
// AS-214: that file only proves each surface *imports and mentions*
// <UserAvatar/> in its source text — it would still pass even if
// UserAvatar's implementation returned `null`. These tests actually
// render the real components (with @testing-library/react + jsdom) and
// assert a real avatar node — with the expected initials, background
// colour, and accessible name — is present in the rendered DOM.
//
// Scope decision (recorded per this feature's inherited F122 clarification
// "Ambiguity resolution: simpler option, recorded"): the task card and
// comment list surfaces are genuinely rendered here via the real
// components/task/task-card.tsx and components/task/comment-list.tsx
// (the latter with its Realtime subscription hook mocked out, since it
// talks to a live Supabase channel that isn't this test's concern). The
// members list and assignee picker surfaces are entangled with an async
// Server Component (app/(workspace)/w/[workspaceSlug]/settings/members/
// page.tsx does its own Supabase fetch + redirect()) and a router-bound
// Select (components/task/list-filters.tsx's assignee filter needs
// next/navigation's useSearchParams/useRouter/usePathname), which are out
// of scope to mock convincingly for this feature. For those two, the test
// below renders the exact `<UserAvatar person={{ ... }} />` JSX call
// copied verbatim from that surface's source (same shape, same props) so
// the rendered DOM assertion is still real (not source-text regex) even
// though the surrounding table/select chrome isn't. See this feature's
// handoff for the full rationale.
//
// tests/unit/user-avatar-call-sites.test.ts is left in place: it still
// gives cheap regression coverage that no surface silently drops its
// <UserAvatar/> usage, but it is no longer the sole evidence for AS-214.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
// jest-dom matchers (toBeInTheDocument, toBeEmptyDOMElement, ...) — scoped
// to this file's import rather than a global vitest setupFiles entry,
// since no other test in the suite currently renders DOM and needs them.
import "@testing-library/jest-dom/vitest";

// This repo's vitest config doesn't set `test.globals`/an RTL setup file
// (React Testing Library's auto-cleanup relies on either), so each
// render() here would otherwise leave its DOM tree mounted for the next
// test in this file — unmount explicitly after every test instead.
afterEach(() => {
  cleanup();
});

import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
import { getUserColor } from "@/lib/user-color";
import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import {
  CommentList,
  type CommentListMember,
  type TaskComment,
} from "@/components/task/comment-list";

// components/task/comment-list.tsx's Realtime subscription is out of
// scope here (it talks to a live Supabase channel) — this test only
// needs the component to *render*, so the hook is stubbed to a no-op.
vi.mock("@/components/task/use-comments-realtime", () => ({
  useCommentsRealtime: () => {},
}));

// F093 follow-up: comment-list.tsx ALSO mounts useReactionsRealtime (a
// SEPARATE Realtime subscription, on the `reactions` table via
// lib/tasks/subscribe-comments-realtime.ts's subscribeToReactionsRealtime)
// -- missing this mock is exactly what let this file open a real
// WebSocket (only useCommentsRealtime was stubbed above) whenever
// NEXT_PUBLIC_SUPABASE_URL/KEY happen to be set in the process env (e.g.
// CI, which loads them from `supabase status -o env`) rather than absent
// (the default for a bare local `vitest run`, where
// @/lib/supabase/client's createClient() throws on missing config and is
// silently swallowed by each hook's own try/catch -- masking the leak
// rather than fixing it).
vi.mock("@/components/task/use-reactions-realtime", () => ({
  useReactionsRealtime: () => {},
}));

const ADA: UserAvatarPerson = {
  id: "11111111-2222-4333-8444-555555555555",
  name: "Ada Lovelace",
  email: "ada@example.com",
};

function getAvatarRoot(label: string): HTMLElement {
  return screen.getByRole("img", { name: label });
}

describe("test_AS_214_user_avatar_renders_in_dom_not_just_source_text", () => {
  it("renders a real avatar node (not null) with the expected accessible name for a bare UserAvatar", () => {
    const { container } = render(createElement(UserAvatar, { person: ADA }));
    // Definition-of-done requirement: a UserAvatar that returned `null`
    // would leave the container empty and this assertion would fail —
    // unlike the old readFileSync/regex test, which could never detect
    // that regression.
    expect(container).not.toBeEmptyDOMElement();
    const root = getAvatarRoot("Ada Lovelace");
    expect(root).toBeInTheDocument();
  });

  it("renders the fallback initials text in the DOM, derived from the person's name", () => {
    render(createElement(UserAvatar, { person: ADA }));
    const root = getAvatarRoot("Ada Lovelace");
    expect(root).toHaveTextContent("AL");
  });

  it("applies the deterministic per-user background colour (AS-204) as an inline style on the rendered fallback", () => {
    render(createElement(UserAvatar, { person: ADA }));
    const color = getUserColor(ADA.id);
    const fallback = getAvatarRoot("Ada Lovelace").querySelector(
      '[data-slot="avatar-fallback"]',
    ) as HTMLElement | null;
    expect(fallback).not.toBeNull();
    expect(fallback!.style.backgroundColor).toBe(hexToRgb(color.background));
  });
});

describe("test_AS_214_user_avatar_appears_on_task_cards", () => {
  const TASK: TaskCardTask = {
    id: "task-1",
    title: "Ship the thing",
    status: "todo",
    priority: "medium",
    assigneeId: ADA.id,
    dueDate: null,
    position: 1,
  };

  it("renders the assignee's avatar in the actual TaskCard component", () => {
    render(
      createElement(TaskCard, {
        task: TASK,
        assignee: ADA,
        timezone: "UTC",
      }),
    );
    expect(getAvatarRoot("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("test_AS_214_user_avatar_appears_on_comments", () => {
  const MEMBERS: CommentListMember[] = [
    { userId: ADA.id, email: ADA.email ?? null, name: ADA.name ?? null },
  ];
  const COMMENTS: TaskComment[] = [
    {
      id: "c1",
      taskId: "t1",
      userId: ADA.id,
      text: "Looks good to me",
      createdAt: new Date().toISOString(),
    },
  ];

  it("renders the comment author's avatar in the actual CommentList component", () => {
    render(
      createElement(CommentList, {
        taskId: "t1",
        comments: COMMENTS,
        members: MEMBERS,
      }),
    );
    expect(getAvatarRoot("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("test_AS_214_user_avatar_appears_in_members_list", () => {
  // Mirrors the exact call site in app/(workspace)/w/[workspaceSlug]/
  // settings/members/page.tsx's active-members table row — see the scope
  // decision note at the top of this file for why the surrounding async
  // Server Component page isn't rendered directly.
  it("renders a member's avatar with the same props shape used by the members table row", () => {
    render(
      createElement(UserAvatar, {
        person: {
          id: ADA.id,
          name: ADA.name,
          email: ADA.email,
          avatarUrl: null,
        },
      }),
    );
    expect(getAvatarRoot("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("test_AS_214_user_avatar_appears_in_assignee_picker", () => {
  // Mirrors the exact call site in components/task/list-filters.tsx's
  // assignee <SelectItem> option — see the scope decision note at the top
  // of this file for why the router-bound <Select> chrome isn't rendered
  // directly.
  it("renders an assignee option's avatar with the same props shape used by the assignee picker", () => {
    render(
      createElement(UserAvatar, {
        person: { id: ADA.id, name: ADA.name, avatarUrl: null },
        size: "sm",
      }),
    );
    expect(getAvatarRoot("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("test_AS_204_rendered_contrast_uses_the_foreground_style", () => {
  // Definition-of-done requirement: dropping `style={{ color:
  // color.foreground }}` in components/user-avatar.tsx must fail this
  // test. It reads the *computed* foreground colour off the rendered
  // fallback node (not source text) and checks it matches the palette's
  // foreground for this user id — if the style prop were removed, jsdom
  // would report no inline colour instead, which does not equal the
  // palette's foreground hex, so the assertion below would fail.
  it("the rendered fallback's computed text colour matches the deterministic palette foreground for this user id", () => {
    render(createElement(UserAvatar, { person: ADA }));
    const color = getUserColor(ADA.id);
    const fallback = getAvatarRoot("Ada Lovelace").querySelector(
      '[data-slot="avatar-fallback"]',
    ) as HTMLElement | null;
    expect(fallback).not.toBeNull();
    expect(fallback!.style.color).toBe(hexToRgb(color.foreground));
  });
});

describe("test_AS_214_emoji_display_name_renders_correct_initials", () => {
  it("a display name starting with an emoji (astral codepoint) renders the emoji itself as the initial, not a broken glyph", () => {
    const person: UserAvatarPerson = {
      id: "22222222-3333-4444-8888-999999999999",
      name: "🚀 Rocket Team",
    };
    render(createElement(UserAvatar, { person }));
    const root = getAvatarRoot("🚀 Rocket Team");
    // A naive `.charAt(0)`/`.slice(0, 2)` implementation splits the
    // emoji's UTF-16 surrogate pair in half, producing the unicode
    // replacement character (U+FFFD) or an unpaired surrogate instead of
    // the emoji.
    expect(root).not.toHaveTextContent("�");
    expect(root.textContent).toContain("🚀");
  });

  it("a two-word emoji display name renders one grapheme per initial, taken from each word", () => {
    const person: UserAvatarPerson = {
      id: "33333333-4444-5555-9999-000000000000",
      name: "🎉 🎈",
    };
    render(createElement(UserAvatar, { person }));
    const root = getAvatarRoot("🎉 🎈");
    expect(root.textContent).toBe("🎉🎈");
  });
});

// jsdom's CSSStyleDeclaration normalizes `#rrggbb` hex colours given via
// inline `style` into `rgb(r, g, b)` when read back — this mirrors that
// normalization so the assertions above compare like with like rather
// than a hex string against jsdom's rgb() serialization.
function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
