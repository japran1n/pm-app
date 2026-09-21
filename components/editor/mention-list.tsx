"use client"

// F203 (AS-371, AS-372, AS-373): the @-mention picker popup.
//
// Rendered by the Tiptap Suggestion plugin's `render()` lifecycle (see
// `mention-extension.ts`) into a floating element anchored to the caret.
// This component owns:
//   - AS-372: filtering the already-narrowed `items` list is done by the
//     caller (`filterMentionItems` in mention-extension.ts) — this
//     component only renders whatever list it's given, so there is a
//     single place ("Notes for clarification" simpler-option rule) that
//     decides what counts as a match.
//   - AS-371/AS-373: keyboard navigation (arrow up/down to move, Enter to
//     select, Escape to dismiss without inserting) is exposed via
//     `onKeyDown` on the imperative handle, matching Tiptap's
//     `SuggestionOptions.render().onKeyDown` contract, which forwards raw
//     DOM keydown events from the editor (the popup itself never holds
//     DOM focus — the editor does, so Escape/Enter/Arrow keys have to be
//     intercepted at the plugin level, not via this component's own
//     onKeyDown prop).

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"

import { cn } from "@/lib/utils"

export type MentionSuggestionItem = {
  /** The user id — this is what gets stored on the mention node (never a
   * frozen display name; see mention-extension.ts). */
  id: string
  /** Display label shown in the picker and used as the initial chip text
   * at insert time — re-resolved from live member data at render time by
   * the shared extension set, never trusted as the source of truth. */
  label: string
}

export interface MentionListHandle {
  /** Returns `true` if the key was handled (and should not reach the
   * editor), matching Tiptap's SuggestionKeyDownProps contract. */
  onKeyDown: (event: { key: string }) => boolean
}

export interface MentionListProps {
  items: MentionSuggestionItem[]
  /** Called with the chosen item; Escape never calls this (AS-371's
   * "dismiss without inserting"). */
  command: (item: MentionSuggestionItem) => void
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0)

    // Keep the highlighted item in range as the filtered list shrinks/grows
    // while typing (AS-372).
    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]
      if (item) command(item)
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ key }) => {
        if (items.length === 0) {
          // Escape still dismisses even with no matches; every other key
          // is a no-op for the (empty) list rather than a handled key, so
          // the editor keeps behaving like a normal text input.
          return key === "Escape"
        }
        if (key === "ArrowUp") {
          setSelectedIndex((current) => (current + items.length - 1) % items.length)
          return true
        }
        if (key === "ArrowDown") {
          setSelectedIndex((current) => (current + 1) % items.length)
          return true
        }
        if (key === "Enter") {
          selectItem(selectedIndex)
          return true
        }
        if (key === "Escape") {
          // AS-371: dismiss without inserting — handled entirely by the
          // caller's onExit (no command() call here); returning true just
          // tells the Suggestion plugin this key was consumed instead of
          // producing a literal "Escape" character.
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div
          role="listbox"
          aria-label="Mention someone"
          className="min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-muted-foreground shadow-xs"
        >
          No matching members
        </div>
      )
    }

    return (
      <div
        role="listbox"
        aria-label="Mention someone"
        className="min-w-40 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xs"
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={cn(
              "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => selectItem(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
    )
  },
)
