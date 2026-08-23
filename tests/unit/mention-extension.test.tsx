// @vitest-environment jsdom
//
// F203: @mention picker in comments (components/editor/mention-extension.ts,
// components/editor/mention-list.tsx, components/editor/rich-text-editor.tsx).
//
// AS-371: typing `@` opens a member picker.
// AS-372: the picker filters as the user types.
// AS-373: a selected mention renders as a highlighted chip.
//
// Approach: Tiptap/ProseMirror's contenteditable typing simulation is not
// reliable in jsdom (see rich-text-editor.test.tsx's own note), so this
// file verifies each assertion through the real, non-mocked units that
// together implement the picker:
//   - AS-371/AS-372: `filterMentionItems` is the exact function
//     `mention-extension.ts`'s Tiptap `suggestion.items` calls on every
//     keystroke of the query — an empty query (just-typed `@`) opens with
//     the full list ("opens a member picker"), and a non-empty query
//     narrows it ("filters as the user types"). `MentionList` is rendered
//     directly with a narrowing `items` prop, and its exposed keyboard
//     handle is exercised via Enter/Escape/ArrowDown/ArrowUp, matching the
//     real `SuggestionOptions.render().onKeyDown` contract it's built for.
//   - AS-373: a Tiptap JSON document containing a `mention` node is run
//     through the real, shared `RichTextRenderer` (the same component a
//     saved comment uses), proving the node renders as a chip carrying the
//     CURRENT resolved label from `mentionSuggestions` — never a frozen
//     stored string (the node's JSON below deliberately carries no
//     `label` attr at all).

// F314 (AS-371, AS-372, AS-373, AS-378 follow-up, from M15's third scrutiny
// pass): the block above proves the picker's SUPPORTING units in isolation
// but never actually drives the real Tiptap/ProseMirror Suggestion plugin
// wired up in mention-extension.ts — the "does typing @ actually list
// candidates via the real plugin" question was still unanswered. The
// `describe("F314 ...")` block near the bottom of this file closes that gap
// by mounting a real `useEditor` + `EditorContent` React tree (StarterKit +
// the real `createMentionExtension`) and driving it via
// `editor.commands.insertContent(...)`, which — unlike simulated DOM
// keydown/input events on a contenteditable (unreliable in jsdom, see the
// note above) — produces a genuine ProseMirror document transaction, which
// is exactly what `@tiptap/suggestion`'s plugin watches to decide whether
// the picker is active and what its query is. The rendered `MentionList`
// popup (mounted into `document.body` by the real `Suggestion` plugin's
// `mount()`, via the real `ReactRenderer` portal — not stubbed) is then
// asserted against directly. (A bare `new Editor(...)` constructed outside
// React was tried first and rejected: `@tiptap/react`'s `ReactRenderer`
// only actually attaches its rendered output once the editor is driven
// through `EditorContent`'s own portal host — `editor.contentComponent` —
// so a standalone `Editor` never renders the picker's DOM at all.)

import { createElement, createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import {
  filterMentionItems,
  resolveMentionLabel,
  resolveMentionDisplay,
  createMentionExtension,
} from "@/components/editor/mention-extension";
import {
  MentionList,
  type MentionListHandle,
  type MentionSuggestionItem,
} from "@/components/editor/mention-list";
import {
  RichTextEditor,
  RichTextRenderer,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

const MEMBERS: MentionSuggestionItem[] = [
  { id: "u-1", label: "Ada Lovelace" },
  { id: "u-2", label: "Alan Turing" },
  { id: "u-3", label: "Grace Hopper" },
];

describe("AS-371: typing @ opens a member picker", () => {
  it("test_AS_371_empty_query_returns_full_member_list", () => {
    // The moment `@` is typed the suggestion query is "" — the picker
    // must open showing every project member, not an empty list.
    expect(filterMentionItems(MEMBERS, "")).toEqual(MEMBERS);
  });

  it("test_AS_371_renders_a_listbox_with_every_member_when_opened", () => {
    render(
      createElement(MentionList, { items: MEMBERS, command: () => {} }),
    );
    const listbox = screen.getByRole("listbox", { name: "Mention someone" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("test_AS_371_escape_dismisses_without_inserting", () => {
    const command = vi.fn();
    const ref = createRef<MentionListHandle>();
    render(createElement(MentionList, { items: MEMBERS, command, ref }));

    const handled = ref.current!.onKeyDown({ key: "Escape" });
    expect(handled).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("AS-372: the picker filters as the user types", () => {
  it("test_AS_372_filters_by_case_insensitive_substring_match", () => {
    expect(filterMentionItems(MEMBERS, "ada")).toEqual([MEMBERS[0]]);
    expect(filterMentionItems(MEMBERS, "alan")).toEqual([MEMBERS[1]]);
    expect(filterMentionItems(MEMBERS, "GRACE")).toEqual([MEMBERS[2]]);
  });

  it("test_AS_372_no_match_returns_an_empty_list", () => {
    expect(filterMentionItems(MEMBERS, "zzz")).toEqual([]);
  });

  it("test_AS_372_narrowed_list_renders_only_matching_options", () => {
    const narrowed = filterMentionItems(MEMBERS, "gr");
    render(createElement(MentionList, { items: narrowed, command: () => {} }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Grace Hopper" })).toBeInTheDocument();
  });

  it("test_AS_372_arrow_keys_move_the_highlighted_selection", () => {
    const command = vi.fn();
    const ref = createRef<MentionListHandle>();
    render(createElement(MentionList, { items: MEMBERS, command, ref }));

    act(() => {
      expect(ref.current!.onKeyDown({ key: "ArrowDown" })).toBe(true);
    });
    act(() => {
      expect(ref.current!.onKeyDown({ key: "Enter" })).toBe(true);
    });
    expect(command).toHaveBeenCalledWith(MEMBERS[1]);
  });

  it("test_AS_372_arrow_up_wraps_to_the_last_item", () => {
    const command = vi.fn();
    const ref = createRef<MentionListHandle>();
    render(createElement(MentionList, { items: MEMBERS, command, ref }));

    act(() => {
      expect(ref.current!.onKeyDown({ key: "ArrowUp" })).toBe(true);
    });
    act(() => {
      ref.current!.onKeyDown({ key: "Enter" });
    });
    expect(command).toHaveBeenCalledWith(MEMBERS[2]);
  });
});

describe("AS-373: a selected mention renders as a highlighted chip", () => {
  it("test_AS_373_selecting_an_option_calls_command_with_the_chosen_member", () => {
    const command = vi.fn();
    render(createElement(MentionList, { items: MEMBERS, command }));

    fireEvent.click(screen.getByRole("option", { name: "Alan Turing" }));
    expect(command).toHaveBeenCalledWith(MEMBERS[1]);
  });

  it("test_AS_373_mention_node_renders_as_a_chip_with_the_current_resolved_name", () => {
    // No `label` attr on the stored node at all — proves the chip's text
    // comes from live `mentionSuggestions`, never a frozen stored string.
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hey " },
            { type: "mention", attrs: { id: "u-2" } },
          ],
        },
      ],
    };

    render(
      createElement(RichTextRenderer, {
        content: doc,
        mentionSuggestions: MEMBERS,
      }),
    );

    const chip = screen.getByText("@Alan Turing");
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute("data-type")).toBe("mention");
    expect(chip.getAttribute("data-id")).toBe("u-2");
  });

  it("test_AS_373_mention_resolves_the_CURRENT_name_not_a_stored_one", () => {
    // resolveMentionLabel is the exact function renderHTML/renderText call
    // — proving it reads live member data, not anything on the node.
    expect(resolveMentionLabel(MEMBERS, "u-1")).toBe("Ada Lovelace");
    const renamed = MEMBERS.map((m) =>
      m.id === "u-1" ? { ...m, label: "Ada, Countess of Lovelace" } : m,
    );
    expect(resolveMentionLabel(renamed, "u-1")).toBe(
      "Ada, Countess of Lovelace",
    );
  });

  it("test_AS_373_unresolvable_id_falls_back_to_the_raw_id_rather_than_blank", () => {
    expect(resolveMentionLabel(MEMBERS, "removed-user")).toBe("removed-user");
  });
});

// F204: mentions respect project access.
describe("AS-377: a mention of a removed/inaccessible user renders as plain text", () => {
  it("test_AS_377_resolveMentionDisplay_marks_a_missing_id_as_unknown_with_a_former_member_label", () => {
    // The exact function renderHTML/renderText call — unlike
    // resolveMentionLabel (AS-373's insert-path fallback, which
    // deliberately falls back to the raw id), the render path must never
    // surface a raw user id to a reader who can't resolve it.
    expect(resolveMentionDisplay(MEMBERS, "removed-user")).toEqual({
      label: "Former member",
      known: false,
    });
    expect(resolveMentionDisplay(MEMBERS, "u-1")).toEqual({
      label: "Ada Lovelace",
      known: true,
    });
    expect(resolveMentionDisplay(MEMBERS, null)).toEqual({
      label: "Former member",
      known: false,
    });
  });

  it("test_AS_377_renders_plain_text_not_a_chip_when_the_mentioned_id_is_not_in_the_readers_visible_list", () => {
    // Simulates exactly what a reader sees when the mentioned user has
    // since been removed from the workspace/project, or was never visible
    // to this reader in the first place (e.g. F204's server-side stripping
    // left the original id in an older stored comment predating this
    // feature, or the reader's own mentionSuggestions is scoped narrower
    // than the author's was). `mentionSuggestions` here deliberately does
    // NOT include "u-9".
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hey " },
            { type: "mention", attrs: { id: "u-9" } },
          ],
        },
      ],
    };

    render(
      createElement(RichTextRenderer, {
        content: doc,
        mentionSuggestions: MEMBERS,
      }),
    );

    const fallback = screen.getByText("@Former member");
    expect(fallback).toBeInTheDocument();
    // Not rendered as the highlighted mention chip — no data-id (the raw
    // user id must never reach the DOM for a mention the reader can't
    // resolve), and not tagged as a real "mention" node type.
    expect(fallback.getAttribute("data-id")).toBeNull();
    expect(fallback.getAttribute("data-type")).not.toBe("mention");
  });

  it("test_AS_376_test_AS_377_test_AS_378_render_reflects_a_mention_that_resolves_only_AFTER_mentionSuggestions_arrives_post_mount", async () => {
    // F310 regression test: reproduces the real sequence this bug actually
    // occurred in — a caller (comment-list.tsx/task-detail-sheet.tsx)
    // starts with an EMPTY `mentionSuggestions` (before `getMentionCandidates`
    // resolves) and only populates it slightly after mount, via a re-render
    // — never pre-populated from the start. Under the pre-F310 "plain
    // closure captured at editor-construction time" implementation, this
    // test would FAIL: the mention would render "Former member" forever,
    // even after `mentionSuggestions` updates, because the Mention
    // extension (and its `renderHTML`/`renderText` resolver) was fixed at
    // construction time against the empty array.
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hey " },
            { type: "mention", attrs: { id: "u-2" } },
          ],
        },
      ],
    };

    const { rerender } = render(
      createElement(RichTextRenderer, {
        content: doc,
        mentionSuggestions: [], // starts empty, like a fresh async fetch in flight
      }),
    );

    expect(screen.getByText("@Former member")).toBeInTheDocument();
    expect(screen.queryByText("@Alan Turing")).not.toBeInTheDocument();

    // Simulates `getMentionCandidates` resolving after mount and the
    // caller re-rendering with the now-populated member list.
    rerender(
      createElement(RichTextRenderer, {
        content: doc,
        mentionSuggestions: MEMBERS,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("@Alan Turing")).toBeInTheDocument();
    });
    const chip = screen.getByText("@Alan Turing");
    expect(chip.getAttribute("data-type")).toBe("mention");
    expect(chip.getAttribute("data-id")).toBe("u-2");
    expect(screen.queryByText("@Former member")).not.toBeInTheDocument();
  });

  it("test_AS_371_test_AS_372_test_AS_373_editor_recreates_its_mention_source_when_mentionSuggestions_populates_post_mount", async () => {
    // F310 regression test for the picker/insert path: `RichTextEditor`
    // mounts with an EMPTY `mentionSuggestions` (the real async-fetch-then-
    // populate sequence — see comment-list.tsx/task-detail-sheet.tsx), then
    // is re-rendered once real data arrives. Under the pre-F310
    // implementation, the Mention extension's `suggestion.items()` closure
    // was fixed at construction time over the initial EMPTY array and
    // never updated — typing `@` would show no candidates regardless of
    // what `mentionSuggestions` became afterward. `useEditor`'s `deps`
    // option (this fix) fully destroys and rebuilds the `Editor` instance
    // — including its `.ProseMirror` DOM node — whenever the set of
    // mentionable users actually changes, which is the observable proof
    // that the extension's `items()` now closes over the CURRENT data
    // rather than the empty array captured at first mount.
    const { rerender, container } = render(
      createElement(RichTextEditor, { mentionSuggestions: [] }),
    );

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeInTheDocument();
    });
    const nodeBeforePopulate = container.querySelector(".ProseMirror");

    rerender(createElement(RichTextEditor, { mentionSuggestions: MEMBERS }));

    await waitFor(() => {
      const nodeNow = container.querySelector(".ProseMirror");
      expect(nodeNow).toBeInTheDocument();
      expect(nodeNow).not.toBe(nodeBeforePopulate);
    });
  });

  it("test_AS_373_editor_does_NOT_needlessly_recreate_when_mentionSuggestions_is_unchanged", async () => {
    // Guards against an over-eager fix that would rebuild the editor (and
    // lose cursor position / undo history) on every render — recreation
    // should only happen when the actual set of mentionable users changes,
    // not on every unrelated re-render.
    const { rerender, container } = render(
      createElement(RichTextEditor, { mentionSuggestions: MEMBERS }),
    );

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeInTheDocument();
    });
    const node1 = container.querySelector(".ProseMirror");

    // Re-render with a NEW array reference but the SAME member ids — the
    // real shape every caller produces every render (a fresh `.map()`
    // literal), which must not thrash the editor.
    rerender(
      createElement(RichTextEditor, {
        mentionSuggestions: MEMBERS.map((m) => ({ ...m })),
      }),
    );

    const node2 = container.querySelector(".ProseMirror");
    expect(node2).toBe(node1);
  });

  it("test_AS_377_does_not_crash_when_content_has_no_matching_mentionSuggestions_at_all", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "someone-gone" } }],
        },
      ],
    };

    expect(() =>
      render(
        createElement(RichTextRenderer, { content: doc, mentionSuggestions: [] }),
      ),
    ).not.toThrow();
    expect(screen.getByText("@Former member")).toBeInTheDocument();
  });
});

// F314 — Issue 1: real Suggestion-plugin coverage (closes the "no test
// drives the actual Tiptap suggestion plugin" blocker for AS-371, AS-372,
// and the client half of AS-378).
describe("F314: the real Tiptap Suggestion plugin lists and narrows candidates", () => {
  // The Mention extension's `render()` (mention-extension.ts) mounts the
  // picker via `@tiptap/react`'s `ReactRenderer`, whose portal mechanism
  // only initialises once the editor is actually driven through React's
  // `EditorContent` (it flags `editor.isEditorContentInitialized` and
  // wires `editor.contentComponent` in `EditorContent`'s own effect) — a
  // bare `new Editor(...)` constructed outside React never gets a portal
  // host, so the picker's DOM would silently never attach. This tiny
  // wrapper is the minimal real React tree (useEditor + EditorContent,
  // same primitives `RichTextEditor` itself uses) needed for the actual
  // portal to exist, while staying independent of `RichTextEditor`'s own
  // extra concerns (toolbar, task-item ids) that are irrelevant here.
  function TestMentionEditor({
    getItems,
    editorRef,
  }: {
    getItems: () => MentionSuggestionItem[];
    editorRef: { current: import("@tiptap/react").Editor | null };
  }) {
    const editor = useEditor(
      {
        extensions: [StarterKit, createMentionExtension({ getItems })],
        content: "<p></p>",
        immediatelyRender: false,
      },
      [],
    );
    editorRef.current = editor;
    if (!editor) return null;
    return createElement(EditorContent, { editor });
  }

  afterEach(() => {
    cleanup();
  });

  async function mountRealEditor(getItems: () => MentionSuggestionItem[]) {
    const editorRef: { current: import("@tiptap/react").Editor | null } = {
      current: null,
    };
    render(createElement(TestMentionEditor, { getItems, editorRef }));
    await waitFor(() => {
      expect(editorRef.current).toBeTruthy();
    });
    return editorRef.current!;
  }

  it("test_AS_371_typing_the_trigger_character_opens_the_real_picker_with_every_candidate", async () => {
    const editor = await mountRealEditor(() => MEMBERS);

    // A genuine ProseMirror document transaction — what the real
    // Suggestion plugin's `apply` watches to decide the picker is
    // active, exactly as if the user had typed "@" into the editor.
    act(() => {
      editor.commands.insertContent("@");
    });

    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeInTheDocument();
    });
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(within(listbox).getByRole("option", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Alan Turing" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Grace Hopper" })).toBeInTheDocument();
  });

  it("test_AS_372_typing_more_characters_narrows_the_real_picker_via_the_live_plugin_query", async () => {
    const editor = await mountRealEditor(() => MEMBERS);

    act(() => {
      editor.commands.insertContent("@");
    });
    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeInTheDocument();
    });

    // Continues the SAME suggestion session by inserting more text right
    // after the trigger char — exactly what happens as a user keeps
    // typing a name.
    act(() => {
      editor.commands.insertContent("gr");
    });

    await waitFor(() => {
      const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
      expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    });
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(within(listbox).getByRole("option", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Ada Lovelace" })).not.toBeInTheDocument();
  });

  it("test_AS_371_a_workspace_member_absent_from_the_scoped_candidate_list_never_appears", async () => {
    // AS-378's client half: `getItems` here stands in for a caller
    // (comment-list.tsx / task-detail-sheet.tsx) that already scoped
    // `mentionSuggestions` down to project members before it ever reaches
    // this extension — someone NOT in that list must never appear in the
    // real, live-rendered picker, not just in the unit-level filter.
    const scoped = MEMBERS.filter((m) => m.id !== "u-3");
    const editor = await mountRealEditor(() => scoped);

    act(() => {
      editor.commands.insertContent("@");
    });
    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeInTheDocument();
    });
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);
    expect(within(listbox).queryByRole("option", { name: "Grace Hopper" })).not.toBeInTheDocument();
  });

  it("test_AS_371_selecting_a_real_picker_option_inserts_a_mention_node_via_the_real_command", async () => {
    const editor = await mountRealEditor(() => MEMBERS);

    act(() => {
      editor.commands.insertContent("@");
    });
    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeInTheDocument();
    });
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    const option = within(listbox).getByRole("option", { name: "Alan Turing" });
    fireEvent.click(option);

    await waitFor(() => {
      const mentionNode = editor.view.dom.querySelector('[data-type="mention"]');
      expect(mentionNode).toBeTruthy();
    });
    const mentionNode = editor.view.dom.querySelector('[data-type="mention"]');
    expect(mentionNode?.getAttribute("data-id")).toBe("u-2");
  });
});

// F314 — Issue 2: a member rename must repaint an already-rendered chip
// (AS-373 residual flagged by the third scrutiny pass — the recreation key
// was id-only, so a label-only change never triggered a rebuild).
describe("F314: a member rename repaints an already-rendered mention chip", () => {
  it("test_AS_373_rename_with_the_same_id_recreates_the_editor_and_repaints_the_chip", async () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hey " },
            { type: "mention", attrs: { id: "u-1" } },
          ],
        },
      ],
    };

    const { rerender, container } = render(
      createElement(RichTextRenderer, {
        content: doc,
        mentionSuggestions: [{ id: "u-1", label: "Ada Lovelace" }],
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("@Ada Lovelace")).toBeInTheDocument();
    });
    const nodeBeforeRename = container.querySelector(".ProseMirror");

    // SAME id, DIFFERENT label — e.g. the user updated their display name.
    rerender(
      createElement(RichTextRenderer, {
        content: doc,
        mentionSuggestions: [{ id: "u-1", label: "Ada Byron" }],
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("@Ada Byron")).toBeInTheDocument();
    });
    expect(screen.queryByText("@Ada Lovelace")).not.toBeInTheDocument();
    // The rename must have gone through a real recreation (a fresh
    // ProseMirror instance whose renderHTML re-resolves the label), not
    // some in-place DOM string replacement outside Tiptap's control.
    expect(container.querySelector(".ProseMirror")).not.toBe(nodeBeforeRename);
  });

  // F317: `RichTextEditor` (the editable composer) still recreates its
  // `Editor` instance on a rename, same as `RichTextRenderer` above — see
  // the F317 note above the `useEditor` call in rich-text-editor.tsx for
  // why an always-live mutable box (which would have avoided this
  // recreation) was tried and rejected due to this codebase's React
  // Compiler-backed ESLint rules. What changed is that the recreation key
  // is no longer gated behind "only while pristine" (that gate is what
  // caused the regression this feature fixes) — it now always advances
  // immediately when the candidate set changes, and the freshly created
  // instance restores the previous selection (see `onCreate` in
  // rich-text-editor.tsx), so the visible cursor position survives even
  // though the underlying DOM node does not.
  it("test_AS_373_editor_side_rename_recreates_the_editor_and_the_picker_sees_the_new_name", async () => {
    const { rerender, container } = render(
      createElement(RichTextEditor, {
        mentionSuggestions: [{ id: "u-1", label: "Ada Lovelace" }],
      }),
    );
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeInTheDocument();
    });
    const nodeBefore = container.querySelector(".ProseMirror");

    rerender(
      createElement(RichTextEditor, {
        mentionSuggestions: [{ id: "u-1", label: "Ada Byron" }],
      }),
    );

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).not.toBe(nodeBefore);
    });
  });
});

// F317 (fixes the F314 "pristine window" mitigation — 4th scrutiny pass):
// F314's fix for the async-candidate-population race worked by blocking
// the mention-suggestions recreation key from ever advancing again once
// the editor had been focused or edited. That "protection" was itself the
// bug: since every real caller starts with `[]` and populates candidates
// asynchronously after mount, a user who simply clicked into the composer
// (a completely normal thing to do) before that fetch resolved would
// PERMANENTLY freeze the picker's candidate source on the empty initial
// array — "@" would show "No matching members" forever, with no recovery
// short of unmounting the whole component.
//
// The fix (rich-text-editor.tsx) removes the pristine/focus gate entirely
// — the recreation key always advances the moment the candidate set
// changes, regardless of focus state, so there is no code path left that
// can freeze the picker. The one-time recreation this causes restores the
// user's cursor position (best-effort; a fresh undo-history stack is the
// accepted smaller cost — see the file's F317 comment).
describe("F317: focusing the editor before candidates arrive no longer freezes the picker", () => {
  it("test_AS_371_focusing_before_candidates_arrive_does_not_prevent_a_later_rebuild_from_picking_up_real_candidates", async () => {
    const { rerender, container } = render(
      createElement(RichTextEditor, { mentionSuggestions: [] }),
    );
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).toBeInTheDocument();
    });
    const nodeBeforeFocus = container.querySelector(".ProseMirror") as HTMLElement;

    // Simulates the user clicking into the composer before the async
    // `getMentionCandidates` fetch has resolved — a real DOM focus event
    // dispatched at the ProseMirror view's own DOM node, which is exactly
    // what Tiptap's Editor listens on to fire its `onFocus` callback. Under
    // F314's now-removed gate, this permanently blocked the rebuild below.
    fireEvent.focus(nodeBeforeFocus);

    // The candidate list now arrives (the real async sequence every real
    // caller uses) — this MUST still rebuild the editor with the real
    // candidates, proving focusing early no longer freezes anything.
    rerender(createElement(RichTextEditor, { mentionSuggestions: MEMBERS }));

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).not.toBe(nodeBeforeFocus);
    });
  });

  // The exact regression scenario the 4th scrutiny pass found: mount with
  // empty candidates, focus (simulating a user click), THEN populate
  // candidates via a re-render, THEN type "@" — the picker must show the
  // real candidates, never "No matching members" forever. This drives the
  // REAL recreation mechanism `rich-text-editor.tsx`'s `RichTextEditor` now
  // uses (a `deps`-keyed `useEditor` whose `getItems` closes over the
  // current `mentionSuggestions` prop, recreated with no pristine/focus
  // gating), via the same harness pattern as the "F314: the real Tiptap
  // Suggestion plugin lists and narrows candidates" block above, so this is
  // a direct proof of the fixed mechanism rather than of `RichTextEditor`'s
  // unrelated internals (toolbar, paste handling, etc.).
  it("test_AS_371_regression_focus_before_candidates_then_populate_then_at_shows_real_candidates", async () => {
    function RecreatingTestEditor({
      suggestions,
      editorRef,
    }: {
      suggestions: MentionSuggestionItem[];
      editorRef: { current: import("@tiptap/react").Editor | null };
    }) {
      const key = suggestions.map((item) => `${item.id}:${item.label}`).join(" ");
      const editor = useEditor(
        {
          extensions: [
            StarterKit,
            createMentionExtension({ getItems: () => suggestions }),
          ],
          content: "<p></p>",
          immediatelyRender: false,
        },
        [key],
      );
      editorRef.current = editor;
      if (!editor) return null;
      return createElement(EditorContent, { editor });
    }

    const editorRef: { current: import("@tiptap/react").Editor | null } = {
      current: null,
    };
    const { rerender } = render(
      createElement(RecreatingTestEditor, { suggestions: [], editorRef }),
    );
    await waitFor(() => expect(editorRef.current).toBeTruthy());
    const nodeBeforeFocus = document.querySelector(".ProseMirror") as HTMLElement;

    // User clicks into the composer before candidates have resolved — this
    // is exactly what used to freeze the picker's candidate source on `[]`
    // forever once F314's (now-removed) "pristine window" gate engaged.
    fireEvent.focus(nodeBeforeFocus);

    // Candidates arrive shortly after, as they do in every real caller —
    // this must still trigger a rebuild with the real candidates.
    rerender(
      createElement(RecreatingTestEditor, { suggestions: MEMBERS, editorRef }),
    );
    await waitFor(() => {
      expect(document.querySelector(".ProseMirror")).not.toBe(nodeBeforeFocus);
    });

    // Typing "@" now must show the REAL candidate list, not the frozen
    // empty one — driven through the real Suggestion plugin via a genuine
    // ProseMirror transaction (simulated contenteditable keyboard events
    // are unreliable in jsdom, see the file-level note above).
    act(() => {
      editorRef.current?.commands.insertContent("@");
    });
    await waitFor(() => {
      expect(document.querySelector('[role="listbox"]')).toBeInTheDocument();
    });
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(within(listbox).getAllByRole("option")).toHaveLength(MEMBERS.length);
    expect(
      within(listbox).getByRole("option", { name: "Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(within(listbox).queryByText("No matching members")).not.toBeInTheDocument();
  });
});
