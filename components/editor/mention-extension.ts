"use client"

// F203 (AS-371, AS-372, AS-373): the Tiptap Mention extension + suggestion
// source wired to a member list scoped to the task's project.
//
// Data source: rather than a new client-side query (which would be a
// second source of truth alongside the `members`/`CommentListMember[]`
// list callers already fetch server-side and pass down as props — the
// project's own "no client-side Supabase queries for initial render"
// convention, see rich-text-editor.tsx and lib/queries/project-members.ts),
// the caller (e.g. comment-list.tsx) passes the same already-scoped member
// list it already has in through `RichTextEditorProps.mentionSuggestions`.
// This file only turns that list into a Tiptap extension; it never fetches
// anything itself. (Clarified implementation → "simpler option that adds
// no new dependency and no second source of truth.")
//
// Storage: the mention node stores ONLY `id` (the user id) — never the
// label/display name — per the spec's explicit note ("Storing the id and
// resolving the name at render is what makes AS-377 work — do not store
// the name."). `resolveLabel` is called fresh every render (both the
// live editor and the read-only renderer), so a member's later name change
// is reflected without touching any previously-saved comment.

import Mention from "@tiptap/extension-mention"
import type { Editor } from "@tiptap/core"
import { ReactRenderer } from "@tiptap/react"
import type { SuggestionOptions } from "@tiptap/suggestion"

import {
  MentionList,
  type MentionListHandle,
  type MentionSuggestionItem,
} from "@/components/editor/mention-list"

export type { MentionSuggestionItem }

/**
 * AS-372: filters the member list against the in-progress query, matching
 * on either name or email, case-insensitively — the same case-insensitive
 * "contains" convention as the project's existing search bar
 * (lib/queries/search.ts). An empty query returns everything (opening the
 * picker with `@` alone shows the full member list — AS-371).
 */
export function filterMentionItems(
  items: MentionSuggestionItem[],
  query: string,
): MentionSuggestionItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => item.label.toLowerCase().includes(needle))
}

/**
 * Resolves a mentioned user's CURRENT display label from a live member
 * list, never from anything stored on the node itself (see file doc
 * comment). Falls back to the raw id so a mention referencing someone no
 * longer resolvable (e.g. removed from the project) still renders as
 * something rather than throwing or going blank.
 */
export function resolveMentionLabel(
  items: MentionSuggestionItem[],
  id: string | null | undefined,
): string {
  if (!id) return ""
  return items.find((item) => item.id === id)?.label ?? id
}

/**
 * F204 (AS-377): the render-time fallback for a mention whose id is not in
 * the *reader's* currently-visible member/suggestion list — either because
 * the mentioned user was removed from the workspace/project, or because
 * this specific reader no longer has visibility into them (the id is not
 * necessarily invalid; `mentionSuggestions` is always scoped to who the
 * current reader can see). Unlike `resolveMentionLabel` above (used by
 * AS-373's "insert" path, which intentionally falls back to the raw id
 * rather than going blank), this is the read-only render path and
 * deliberately never surfaces the raw user id — a UUID leaking into
 * rendered text isn't a meaningful label for a reader who can't resolve it
 * anyway, and doing so would be exactly the "leak identity" failure mode
 * this feature's spec calls out. `known: false` means "render as plain
 * text, not a chip" — see renderHTML/renderText below.
 */
export function resolveMentionDisplay(
  items: MentionSuggestionItem[],
  id: string | null | undefined,
): { label: string; known: boolean } {
  if (!id) return { label: "Former member", known: false }
  const found = items.find((item) => item.id === id)
  return found
    ? { label: found.label, known: true }
    : { label: "Former member", known: false }
}

/**
 * Builds a Mention extension bound to a *live* getter for the current
 * member list, so the same extension instance always filters/renders
 * against up-to-date `mentionSuggestions` props (rich-text-editor.tsx
 * re-passes `getItems`/`getResolveItems` closures that read the latest
 * value on every call — no stale closure captured at editor-construction
 * time).
 */
export function createMentionExtension({
  getItems,
}: {
  getItems: () => MentionSuggestionItem[]
}) {
  return Mention.configure({
    HTMLAttributes: {
      class:
        "rounded bg-primary/10 px-1 py-0.5 font-medium text-primary",
    },
    suggestion: {
      char: "@",
      allowSpaces: false,
      items: ({ query }: { query: string }) =>
        filterMentionItems(getItems(), query),
      render: () => {
        let component: ReactRenderer<MentionListHandle> | null = null
        let unmount: (() => void) | null = null

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              props: {
                items: props.items as MentionSuggestionItem[],
                command: (item: MentionSuggestionItem) => {
                  props.command({ id: item.id, label: item.label })
                },
              },
              editor: props.editor,
            })

            if (!props.clientRect) return

            unmount = props.mount(component.element, {})
          },
          onUpdate: (props) => {
            component?.updateProps({
              items: props.items as MentionSuggestionItem[],
              command: (item: MentionSuggestionItem) => {
                props.command({ id: item.id, label: item.label })
              },
            })
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              unmount?.()
              component?.destroy()
              return true
            }
            return (
              (component?.ref as MentionListHandle | undefined)?.onKeyDown(
                props.event,
              ) ?? false
            )
          },
          onExit: () => {
            unmount?.()
            component?.destroy()
            component = null
            unmount = null
          },
        }
      },
      // AS-373: what actually gets inserted — id-only attrs; `label` is
      // intentionally NOT written so nothing can accidentally read a
      // frozen name back out of the stored document (renderHTML below
      // always re-resolves it live instead).
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: "mention",
              attrs: { id: (props as MentionSuggestionItem).id },
            },
            { type: "text", text: " " },
          ])
          .run()
      },
    } satisfies Partial<SuggestionOptions<MentionSuggestionItem>>,
    // AS-373 / AS-377: resolves the label live via `getItems()` on every
    // render pass — never reads `node.attrs.label` (which this extension
    // never sets — see `command` above). A mention whose id isn't
    // resolvable against the CURRENT reader's `mentionSuggestions`
    // (removed from the workspace/project, or simply not visible to this
    // reader) renders as plain, unstyled text instead of the highlighted
    // chip — no `data-id`, no raw user id ever reaches the DOM (AS-377: "a
    // mention of a removed user renders as plain text").
    renderHTML({ node }) {
      const id = node.attrs.id as string | null
      const { label, known } = resolveMentionDisplay(getItems(), id)
      if (!known) {
        return [
          "span",
          { "data-type": "mention-unresolved", class: "text-muted-foreground" },
          `@${label}`,
        ]
      }
      return [
        "span",
        {
          "data-type": "mention",
          "data-id": id ?? "",
          class:
            "rounded bg-primary/10 px-1 py-0.5 font-medium text-primary",
        },
        `@${label}`,
      ]
    },
    renderText({ node }) {
      const id = node.attrs.id as string | null
      return `@${resolveMentionDisplay(getItems(), id).label}`
    },
  })
}

export type { Editor }
