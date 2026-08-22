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

import { createElement, createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  filterMentionItems,
  resolveMentionLabel,
} from "@/components/editor/mention-extension";
import {
  MentionList,
  type MentionListHandle,
  type MentionSuggestionItem,
} from "@/components/editor/mention-list";
import { RichTextRenderer, type JSONContent } from "@/components/editor/rich-text-editor";

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
