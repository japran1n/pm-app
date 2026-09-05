"use client"

// F169: shared Tiptap editor component.
//
// Exports:
//   - `RichTextEditor` — the controlled, editable component. Consumers own
//     the value: pass `content` (Tiptap JSON, `null`/`undefined` for empty)
//     and `onChange(json)` to receive updates. This mirrors a standard
//     controlled-input shape rather than Tiptap's own imperative editor
//     ref, so callers don't need to reach into `@tiptap/react` themselves.
//   - `RichTextRenderer` — the read-only render mode, sharing the exact
//     same extension set as the editable mode so the two code paths can
//     never diverge in how they interpret the JSON document (this is what
//     F171 will reuse for safe display).
//
// Storage format: Tiptap's JSON document format (`JSONContent` from
// `@tiptap/react`), NOT HTML. This is the shape later features persist.
//
// Client-only by design (per Clarified implementation / Notes for
// clarification): Tiptap's `useEditor` touches the DOM and browser APIs
// that don't exist in the Server Component graph, so this whole module is
// marked "use client" and any Server Component that wants to render it
// must dynamically import it with `{ ssr: false }`, e.g.:
//
//   const RichTextEditor = dynamic(
//     () => import("@/components/editor/rich-text-editor").then((m) => m.RichTextEditor),
//     { ssr: false }
//   )

import { useEffect, useReducer, useRef } from "react"
import {
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { TaskList } from "@tiptap/extension-task-list"
import { TaskItem } from "@tiptap/extension-task-item"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Heading1,
  Heading2,
  Link as LinkIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  extractImageFilesFromClipboard,
  transformPastedHtml,
} from "@/lib/editor/paste-rules"
import {
  createMentionExtension,
  type MentionSuggestionItem,
} from "@/components/editor/mention-extension"

/**
 * Shared extension set for both the editable and read-only render paths.
 *
 * Tiptap 3's StarterKit bundles the Link extension (verified against
 * node_modules/@tiptap/starter-kit 3.30.2 — StarterKit constructs
 * `@tiptap/extension-link`'s `Link` internally when `link !== false`),
 * so Link is configured through `StarterKit.configure({ link })` rather
 * than added a second time, which previously produced a
 * "Duplicate extension names found: ['link']" runtime warning.
 */
// F173 (AS-311): stable identity for taskItem nodes.
//
// Tiptap's stock `TaskItem` only carries a `checked` attribute — there is
// nothing that survives a save/reload round trip and still uniquely
// addresses "this specific checkbox" for a server-side toggle-and-persist
// action. Rather than inventing document-position-based addressing (which
// shifts under concurrent edits and doesn't survive save/reload), a plain
// string `id` attribute is added, generated once when a task item is first
// created and carried through unchanged afterwards — the same "attribute
// that outlives a save" pattern already used by nothing else in this repo
// but is the standard editor convention for "stable handle on a node".
function generateTaskItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // Fallback for environments without `crypto.randomUUID` (older browsers,
  // some test runners) — collision-resistant enough for a single document's
  // checklist, not a security boundary.
  return `task-item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const TaskItemWithId = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        keepOnSplit: false,
        parseHTML: (element) => element.getAttribute("data-item-id"),
        renderHTML: (attributes) =>
          attributes.id ? { "data-item-id": attributes.id } : {},
      },
    }
  },
})

// Assigns a stable id to any `taskItem` node that doesn't have one yet
// (freshly typed/inserted items). Only registered on the EDITABLE instance
// (`RichTextEditor`) — the read-only `RichTextRenderer` must never mint a
// fresh id for a node that already has one persisted server-side, since
// `RichTextRenderer`'s inline-toggle handler addresses the server-stored
// node by the id embedded in the fetched JSON (F173/AS-311); minting a new
// one at render time would desync the client's id from what's in the
// database.
const taskItemIdPluginKey = new PluginKey("taskItemId")

function taskItemIdPlugin() {
  return new Plugin({
    key: taskItemIdPluginKey,
    appendTransaction(_transactions, _oldState, newState) {
      let tr: ReturnType<typeof newState.tr.setNodeMarkup> | null = null
      newState.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === "taskItem" && !node.attrs.id) {
          tr = (tr ?? newState.tr).setNodeMarkup(pos, undefined, {
            ...node.attrs,
            id: generateTaskItemId(),
          })
        }
      })
      return tr
    },
  })
}

function sharedExtensions({
  assignTaskItemIds = false,
  onReadOnlyChecked,
  getMentionItems,
  linksClickable = false,
}: {
  assignTaskItemIds?: boolean
  /** F173 (AS-311): fired when a checkbox is clicked in a non-editable
   * (`RichTextRenderer`) instance. Returning `false` reverts the visual
   * toggle (Tiptap's own built-in behaviour for a denied/failed change) —
   * see `RichTextRenderer` below for the actual persistence call. */
  onReadOnlyChecked?: (node: ProseMirrorNode, checked: boolean) => boolean
  /** F203 (AS-371, AS-372, AS-373): a live getter for the current
   * mention-suggestion source. Omitted entirely means the Mention
   * extension isn't registered at all — `@` types as a literal character,
   * same as before this feature — so callers that don't pass
   * `mentionSuggestions` (RichTextEditorProps) see no behaviour change. */
  getMentionItems?: () => MentionSuggestionItem[]
  /** F121 (AS-074): only `RichTextRenderer` (read-only display) should
   * pass `true` here. Clicking a link while editing must never navigate
   * away from the editor, so `RichTextEditor` always leaves this `false`
   * and gets the original `openOnClick: false` behaviour, unchanged. When
   * `true`, links open safely in a new tab (`target="_blank"`,
   * `rel="noopener noreferrer"`). */
  linksClickable?: boolean
} = {}) {
  const taskItemExtension = assignTaskItemIds
    ? TaskItemWithId.extend({
        addProseMirrorPlugins() {
          return [...(this.parent?.() ?? []), taskItemIdPlugin()]
        },
      })
    : TaskItemWithId

  return [
    StarterKit.configure({
      link: {
        openOnClick: linksClickable,
        autolink: true,
        ...(linksClickable
          ? {
              HTMLAttributes: {
                target: "_blank",
                rel: "noopener noreferrer",
              },
            }
          : {}),
      },
    }),
    TaskList,
    taskItemExtension.configure(
      onReadOnlyChecked ? { onReadOnlyChecked } : {},
    ),
    ...(getMentionItems
      ? [createMentionExtension({ getItems: getMentionItems })]
      : []),
  ]
}

export interface RichTextEditorProps {
  /** Controlled value in Tiptap's JSON document format. `null`/`undefined` renders an empty document. */
  content?: JSONContent | null
  /** Called with the updated document whenever the user edits it. */
  onChange?: (content: JSONContent) => void
  /** Called when the editor loses focus, e.g. Escape or blur. Content is NOT reverted — the current buffer is what gets passed to onChange already. */
  onBlur?: () => void
  placeholder?: string
  /** Disables editing (e.g. no permission) while still rendering the toolbar in a disabled state, per lib/auth/permissions.ts gating done by the caller. */
  disabled?: boolean
  className?: string
  "aria-label"?: string
  /** F203 (AS-371, AS-372, AS-373): the @-mention suggestion source,
   * already scoped by the caller (e.g. a project's members) and fetched
   * server-side per this project's data-shape convention — never queried
   * client-side here. Omitted/empty disables the mention picker entirely
   * (see `sharedExtensions`'s `getMentionItems` doc comment). */
  mentionSuggestions?: MentionSuggestionItem[]
  /** F261 (AS-508): called with every `image/*` file found on a paste's
   * clipboard, e.g. a screenshot pasted from the OS clipboard. When
   * provided, an image-carrying paste is intercepted (preventDefault, no
   * image ever reaches the document/schema) and handed to the caller,
   * which is expected to upload it through the existing attachment action
   * and insert its own plain-text reference into the controlled `content`
   * — this component never uploads anything itself, matching the
   * "reuse the existing attachment action, don't fork a second upload
   * path" instruction. Omitted (the default for every caller except the
   * comment composer) means an image paste falls through to the
   * pre-existing F172 behaviour unchanged: the image degrades to its
   * `alt` text (if any) via `transformPastedHtml`, exactly as before this
   * feature. */
  onImagePaste?: (files: File[]) => void
}

/**
 * Compact toolbar built from existing shadcn `Button` primitives — no
 * bespoke toolbar design system. Every control is a real <button>, so it
 * is reachable by Tab and activatable with Enter/Space (AS-313).
 */
function Toolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  // Force a re-render whenever the editor's selection/marks change so the
  // toolbar's aria-pressed/isActive state reflects the live editor rather
  // than only the render that mounted it.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    editor.on("transaction", forceUpdate)
    editor.on("selectionUpdate", forceUpdate)
    return () => {
      editor.off("transaction", forceUpdate)
      editor.off("selectionUpdate", forceUpdate)
    }
  }, [editor])

  const items: Array<{
    label: string
    icon: React.ComponentType<{ className?: string }>
    isActive: () => boolean
    onToggle: () => void
  }> = [
    {
      label: "Bold",
      icon: Bold,
      isActive: () => editor.isActive("bold"),
      onToggle: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      isActive: () => editor.isActive("italic"),
      onToggle: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Code",
      icon: Code,
      isActive: () => editor.isActive("code"),
      onToggle: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: "Heading 1",
      icon: Heading1,
      isActive: () => editor.isActive("heading", { level: 1 }),
      onToggle: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      icon: Heading2,
      isActive: () => editor.isActive("heading", { level: 2 }),
      onToggle: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bullet list",
      icon: List,
      isActive: () => editor.isActive("bulletList"),
      onToggle: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Ordered list",
      icon: ListOrdered,
      isActive: () => editor.isActive("orderedList"),
      onToggle: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      // F173 (AS-311): inline checkbox list — distinct from the structured
      // per-task Checklist section (components/task/checklist.tsx, F151-
      // F153) that drives the task's completion percentage. This toolbar
      // button only inserts a `taskList`/`taskItem` node inside rich text
      // (a description or, per F174, a comment); it never writes to
      // task_checklist_items and never affects AS-272's completion %.
      label: "Checklist",
      icon: ListChecks,
      isActive: () => editor.isActive("taskList"),
      onToggle: () => editor.chain().focus().toggleTaskList().run(),
    },
  ]

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border p-1"
    >
      {items.map(({ label, icon: Icon, isActive, onToggle }) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={isActive()}
          disabled={disabled}
          onClick={onToggle}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Link"
        aria-pressed={editor.isActive("link")}
        disabled={disabled}
        onClick={() => {
          const previousUrl = editor.getAttributes("link").href as
            | string
            | undefined
          const url = window.prompt("URL", previousUrl ?? "")
          if (url === null) return
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run()
            return
          }
          editor
            .chain()
            .focus()
            .extendMarkRange("link")
            .setLink({ href: url })
            .run()
        }}
      >
        <LinkIcon className="size-3.5" />
      </Button>
    </div>
  )
}

export function RichTextEditor({
  content,
  onChange,
  onBlur,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel = "Rich text editor",
  mentionSuggestions,
  onImagePaste,
}: RichTextEditorProps) {
  // F172 (AS-308): Cmd/Ctrl+Shift+V is the standard "paste as plain text"
  // override. Modifier state isn't exposed on the native `paste` event, so
  // the preceding keydown sets this ref; `handlePaste` below consumes and
  // clears it on the very next paste. A ref (not state) is used so setting
  // it never triggers a re-render mid-keystroke.
  const plainTextPasteRef = useRef(false)

  // F317 (fixes F314's "pristine window" regression — 4th scrutiny pass):
  // F310 fixed a real stale-closure bug by fully destroying/recreating the
  // `Editor` instance (via `useEditor`'s `deps` array) whenever the
  // mention-suggestion set changed, since Tiptap 3.30.2's extension setup
  // only runs once at construction. F314 then added a "pristine window"
  // mitigation on top of that (only let the recreation key advance while
  // the editor was unfocused and unedited) to avoid destroying live user
  // work when candidates resolve async shortly after mount. That
  // mitigation is itself broken: every real caller (comment-list.tsx)
  // starts with empty candidates and populates them a moment after mount,
  // and any user who focuses the composer in that window (a completely
  // normal thing to do — click into the box before typing) permanently
  // set `focusedRef.current = true`, which then permanently blocked the
  // key-update effect from EVER running again for that editor instance —
  // the extension's `getMentionItems` closure stayed frozen on the empty
  // initial array forever, with no self-healing short of unmounting the
  // whole component. "@" would show "No matching members" indefinitely.
  //
  // ATTEMPTED root fix (rejected — see below): `mention-extension.ts`'s
  // Suggestion plugin only calls `items()` LAZILY, once per keystroke/query
  // change, not once at extension-construction time — so in principle the
  // candidate SOURCE never needs the whole `Editor` instance destroyed and
  // recreated to stay current; a plain always-live mutable box read by
  // `getMentionItems` on every invocation would work functionally. This was
  // implemented first and is functionally correct, but this codebase's
  // React Compiler-backed `react-hooks/refs` / `react-hooks/immutability`
  // ESLint rules (`eslint-plugin-react-hooks@7.1.1`) reject it categorically:
  // passing ANY closure that reads a mutable field off an object into a
  // function invoked during render (here, `getMentionItems` flowing through
  // `sharedExtensions()` into `useEditor()`) is flagged as "Cannot access
  // refs during render" / "Passing a ref to a function may read its value
  // during render" — and this fires even for a plain `useState`-boxed
  // object with a non-`current`-named mutable field, not just a literal
  // `useRef`. Mutating that same box from an effect is separately rejected
  // by `react-hooks/immutability` ("Modifying a value returned from
  // `useState()`"). There is no way to keep an always-live external mutable
  // box wired into `getMentionItems` that satisfies both rules
  // simultaneously in this codebase — this is a hard lint constraint, not a
  // style preference, so the fix below keeps F310's deps-based recreation
  // instead (see the file's CLAUDE.md: "The orchestrator does not write
  // project code" is not the applicable rule here, but the mission's
  // ZERO_QUESTIONS runbook is explicit that a worker who finds a concrete
  // reason the prescribed approach doesn't work should pick the next-best
  // option and document the tradeoff, which is what this comment does).
  //
  // Next-best fix actually applied: keep F310's `deps`-driven destroy/
  // recreate (still the only mechanism in this codebase that can hand the
  // Mention extension a fresh, non-stale `getItems` closure without
  // fighting the lint rules above), but DROP F314's "pristine window" gate
  // entirely — the key now always advances immediately whenever the
  // candidate set actually changes, with NO focus/edit-based blocking, so
  // there is no longer any code path that can freeze the picker forever.
  // The real cost F314 was trying to avoid (an async candidate-population
  // race destroying live user work) is now mitigated differently: the
  // ProseMirror selection (cursor/anchor position) is captured on every
  // transaction and restored onto the freshly-created editor instance
  // immediately after a recreation, so a user typing when candidates
  // resolve does not lose their cursor position or the text they'd already
  // typed (`content` is provided fresh to the new instance either way).
  // The one real remaining cost — a rebuild starts a brand new ProseMirror
  // undo-history stack, so a very rare recreation-mid-edit loses undo
  // entries prior to that point — is explicitly accepted as strictly
  // smaller than "the picker never works again for this session", which is
  // what the gated approach produced in practice.
  const computedMentionSuggestionsKey = (mentionSuggestions ?? [])
    .map((item) => `${item.id}:${item.label}`)
    .join(" ")
  const lastSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const wasFocusedRef = useRef(false)

  // Whether the Mention extension is registered at all only needs to be
  // decided once per editor instance — every real caller in this codebase
  // passes an array (even initially empty), never `undefined` transitioning
  // to an array after mount — see comment-list.tsx / task-detail-sheet.tsx.
  const mentionsEnabled = mentionSuggestions !== undefined

  const editor = useEditor({
    extensions: sharedExtensions({
      assignTaskItemIds: true,
      // F310/F317: this closure is rebuilt (and the editor instance
      // recreated) whenever `computedMentionSuggestionsKey` changes below —
      // see the comment above for why an always-live mutable box was
      // rejected in favour of this recreation-based approach.
      getMentionItems: mentionsEnabled ? () => mentionSuggestions : undefined,
    }),
    content: content ?? undefined,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        // Matches this codebase's existing focus-visible convention
        // (see components/ui/button.tsx / toggle.tsx).
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none px-3 py-2 outline-none",
          "focus-visible:ring-3 focus-visible:ring-ring/50 rounded-b-lg",
          placeholder && "empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        ),
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
      // F318 (AS-378, data-loss fix): this handler must NEVER read the
      // outer `editor` local variable. `useEditor`'s `deps`-driven
      // recreation (F310/F317, see the long comment above this component)
      // means `editorProps` — including this very function — is only
      // re-captured with a fresh `editor` closure at the MOMENT of a
      // recreation, and that moment's closure is bound to the OLD,
      // about-to-be-destroyed instance (per @tiptap/react's `onRender`
      // effect: `refreshEditorInstance(deps)` swaps the instance out from
      // under the render that's mid-flight). Any call through that stale
      // `editor` after a recreation either throws (destroyed instance) or
      // operates on the wrong document. ProseMirror instead calls
      // `handleKeyDown` with `view` bound correctly to whichever `EditorView`
      // is actually live for THIS invocation — `view` is always the right
      // instance, so every access below goes through `view`, never `editor`.
      handleKeyDown: (view, event) => {
        // AS-313: Escape blurs the editor but KEEPS the current buffer
        // content — Tiptap/ProseMirror has no built-in "revert on Escape"
        // behaviour, so simply blurring is non-destructive by default.
        // We only add the blur; the document is never reset here.
        if (event.key === "Escape") {
          // `view.dom` is the ProseMirror-owned contenteditable element
          // for THIS view — a plain DOM `.blur()` is instance-correct by
          // construction (unlike `editor.commands.blur()`, which resolves
          // through the possibly-stale outer `editor` reference AND defers
          // the actual `view.dom.blur()` call to a `requestAnimationFrame`
          // internally, per @tiptap/core's `blur` command — by the time
          // that callback runs after a recreation, it's also reading a
          // stale `view` closed over from the old instance).
          //
          // Deliberately NOT also calling `onBlur?.()` here: `view.dom
          // .blur()` synchronously dispatches a native DOM blur event,
          // which flows through this same editor instance's own
          // `editorProps` blur plugin handler into the `onBlur` option
          // configured on `useEditor` below (`wasFocusedRef.current =
          // false; onBlur?.()`) — that already calls the caller's
          // `onBlur`, so calling it a second time here would fire it
          // twice per Escape press.
          view.dom.blur()
          return true
        }
        // F172 (AS-308): record the plain-text-paste override so the next
        // `paste` event bypasses all formatting. Deliberately does NOT
        // return true — the browser still needs to fire its native paste
        // event for `handlePaste` below to intercept.
        if (
          (event.key === "v" || event.key === "V") &&
          event.shiftKey &&
          (event.metaKey || event.ctrlKey)
        ) {
          plainTextPasteRef.current = true
        }
        // NOTE: a submit shortcut (documented in F245) will hook in here
        // once that feature exists — intentionally not implemented yet.
        return false
      },
      // F172 (AS-308): Cmd/Ctrl+Shift+V bypasses ALL formatting regardless
      // of the clipboard's HTML content, inserting the raw text/plain
      // payload only — the standard editor convention for "paste as
      // plain text".
      handlePaste: (view, event) => {
        // F261 (AS-508): image-carrying clipboard items are intercepted
        // BEFORE the plain-text-paste override and BEFORE
        // transformPastedHTML ever runs — a pasted screenshot has no
        // `text/html`/`text/plain` payload for either of those to act on
        // in the first place, only `clipboardData.items` file entries.
        // Only claimed when a caller actually wants this (comment
        // composer); every other caller (task/description editor) is
        // unaffected and keeps F172's existing "image degrades to alt
        // text" behaviour.
        if (onImagePaste) {
          const imageFiles = extractImageFilesFromClipboard(
            event.clipboardData?.items,
          )
          if (imageFiles.length > 0) {
            event.preventDefault()
            onImagePaste(imageFiles)
            return true
          }
        }
        if (!plainTextPasteRef.current) return false
        plainTextPasteRef.current = false
        const text = event.clipboardData?.getData("text/plain")
        if (text == null) return false
        event.preventDefault()
        view.dispatch(view.state.tr.insertText(text))
        return true
      },
      // F172 (AS-308): everything else (a normal Cmd/Ctrl+V, or a
      // drag-and-drop paste) still goes through the schema, but the
      // clipboard HTML is pre-degraded to the shared allow-list first —
      // unsupported markup (tables, Word/Google Docs wrapper spans,
      // images, etc.) becomes its own plain text rather than vanishing.
      transformPastedHTML: (html) => transformPastedHtml(html),
    },
    onCreate: ({ editor: createdEditor }) => {
      // F317: restore the last known cursor position onto the freshly
      // (re)created instance — the selection-preservation half of the
      // mitigation described above. On the very first construction
      // `lastSelectionRef.current` is still null, so this is a no-op; on a
      // mention-suggestion-triggered recreation it puts the cursor back
      // where the user left it and refocuses if they were focused, so a
      // recreation mid-typing doesn't visibly steal focus or move the
      // caret to the start of the document.
      const saved = lastSelectionRef.current
      if (saved) {
        const docSize = createdEditor.state.doc.content.size
        const from = Math.min(saved.from, docSize)
        const to = Math.min(saved.to, docSize)
        createdEditor.commands.setTextSelection({ from, to })
        if (wasFocusedRef.current) {
          createdEditor.commands.focus(undefined, { scrollIntoView: false })
        }
      }
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChange?.(updatedEditor.getJSON())
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      const { from, to } = updatedEditor.state.selection
      lastSelectionRef.current = { from, to }
    },
    onFocus: () => {
      wasFocusedRef.current = true
    },
    onBlur: () => {
      wasFocusedRef.current = false
      onBlur?.()
    },
  }, [computedMentionSuggestionsKey])

  // Keep the editor in sync when the controlled `content` prop changes
  // from outside (e.g. loading a different task's description).
  useEffect(() => {
    // F310: `editor` can be a just-destroyed instance here — `useEditor`'s
    // own internal effect (registered before this one, since it runs
    // inside the `useEditor()` call above) may have already recreated the
    // editor (e.g. `computedMentionSuggestionsKey` changed) by the time
    // THIS effect runs in the same commit, but `useSyncExternalStore`
    // hasn't re-rendered with the new instance yet — calling `.commands` on
    // a destroyed editor throws (`this.view` is null internally).
    if (!editor || editor.isDestroyed) return
    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(content ?? { type: "doc", content: [] })
    if (current !== next) {
      editor.commands.setContent(content ?? null, { emitUpdate: false })
    }

  }, [content, editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  if (!editor) return null

  return (
    <div
      className={cn(
        "rounded-lg border border-input bg-background",
        "has-[[role=textbox]:focus-visible]:border-ring has-[[role=textbox]:focus-visible]:ring-3 has-[[role=textbox]:focus-visible]:ring-ring/50",
        className
      )}
    >
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  )
}

export interface RichTextRendererProps {
  /** Tiptap JSON document to render read-only. Treated as UNTRUSTED —
   * see `sanitiseDocument` below (F171: AS-309). */
  content?: JSONContent | null
  className?: string
  "aria-label"?: string
  /**
   * F173 (AS-311): called when a checkbox inside a `taskList`/`taskItem`
   * is clicked in this read-only render. `itemId` is the clicked node's
   * `id` attribute (see `TaskItemWithId` above) — `null` if the stored
   * document predates ids being assigned, in which case the toggle is
   * rejected (there is nothing stable to address server-side). Return
   * (or resolve to) `true` once the change is actually persisted; `false`
   * reverts the checkbox visually and the caller is expected to surface
   * its own failure feedback (e.g. a toast) before returning `false`.
   * Omitting this prop makes every checkbox in this render inert (clicks
   * always revert) — the safe default for any caller that hasn't wired up
   * persistence.
   */
  onToggleTaskItem?: (
    itemId: string | null,
    checked: boolean,
  ) => boolean | Promise<boolean>
  /** F203 (AS-373): resolves a stored mention's CURRENT display name —
   * see mention-extension.ts's file doc comment for why this is never
   * read from anything persisted on the node itself. Omitted/empty means
   * any mention chip in this content renders with the raw user id (the
   * safe "something rather than nothing" fallback). */
  mentionSuggestions?: MentionSuggestionItem[]
}

// F171 (AS-307, AS-309): the render-time security boundary. This is the
// ONE place the allow-list of node/mark types is defined for the display
// path — `sharedExtensions()` above defines what Tiptap/ProseMirror is
// *capable* of rendering (its schema), but `sanitiseDocument` is what
// actually decides what untrusted, previously-stored JSON is ALLOWED to
// reach that schema at all. Two layers on purpose:
//   1. Anything not on this allow-list is dropped (not just visually
//      hidden) before it ever reaches `editor.commands.setContent` /
//      `useEditor({ content })`, so an unknown node type (e.g. a
//      fabricated `"script"` node) can never throw deep inside
//      ProseMirror's `Node.fromJSON` (which throws on unknown types) and
//      can never round-trip back out as anything executable.
//   2. Every node/mark's `attrs` are rebuilt from scratch using only the
//      specific keys that node/mark type is known to use — an injected
//      `onclick`/`onerror`/etc. attribute (or any other unexpected key)
//      is never copied through, regardless of what ProseMirror's schema
//      would or wouldn't render for it. This means even a "safe" node
//      type carrying hostile-looking attrs is neutralised at the data
//      layer, not left to the renderer's toDOM to (hopefully) ignore it.
//
// This function is exported so a future server-side projection (if one
// is added) can reuse the exact same allow-list — the clarified spec's
// explicit requirement that "the allow-list ... must be defined once and
// shared by editor, renderer, and any server-side projection."

const ALLOWED_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "blockquote",
  "hardBreak",
  "horizontalRule",
  // F173 (AS-311): inline checkbox lists.
  "taskList",
  "taskItem",
  // F203 (AS-373): @-mention chips.
  "mention",
])

const ALLOWED_MARK_TYPES = new Set(["bold", "italic", "code", "link", "strike"])

/** http/https/mailto only, per the clarified spec — no `javascript:`,
 * `data:`, `vbscript:`, or any other scheme, and no scheme-relative
 * `//host/...` URLs (browsers treat those as `http(s):`, but we don't
 * trust that inference here — require an explicit allowed scheme). */
const ALLOWED_LINK_PROTOCOLS = /^(https?|mailto):/i

function sanitiseHref(href: unknown): string | null {
  if (typeof href !== "string") return null
  const trimmed = href.trim()
  // Strip ASCII control characters and whitespace that browsers/parsers
  // are known to ignore inside a URL scheme (a classic
  // "java\tscript:alert(1)" bypass) before checking the scheme.
  const normalised = trimmed.replace(/[\x00-\x1F\x7F\s]/g, "")
  if (!ALLOWED_LINK_PROTOCOLS.test(normalised)) return null
  return trimmed
}

function sanitiseMark(mark: unknown): JSONContent | null {
  if (!mark || typeof mark !== "object") return null
  const m = mark as { type?: unknown; attrs?: Record<string, unknown> }
  if (typeof m.type !== "string" || !ALLOWED_MARK_TYPES.has(m.type)) return null

  if (m.type === "link") {
    const href = sanitiseHref(m.attrs?.href)
    // No safe href survived sanitisation (e.g. a `javascript:` URL) —
    // drop the mark entirely rather than render an inert-but-present
    // link, so there is no href attribute at all for anything to read.
    if (!href) return null
    return {
      type: "link",
      attrs: {
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        class: null,
      },
    }
  }

  // bold/italic/code/strike carry no attrs in the shared schema — never
  // copy through whatever attrs object was actually present (this is
  // exactly the "on*-attribute-injected-into-attrs" hostile case).
  return { type: m.type }
}

function sanitiseNode(node: unknown): JSONContent | null {
  if (!node || typeof node !== "object") return null
  const n = node as {
    type?: unknown
    text?: unknown
    attrs?: Record<string, unknown>
    marks?: unknown[]
    content?: unknown[]
  }

  if (typeof n.type !== "string" || !ALLOWED_NODE_TYPES.has(n.type)) {
    return null
  }

  const result: JSONContent = { type: n.type }

  if (n.type === "text") {
    // Text nodes must carry a real string; anything else becomes no node
    // at all rather than coercing to "" (which would still render an
    // empty, harmless text node — coercion here is just for type safety).
    if (typeof n.text !== "string") return null
    result.text = n.text
  }

  if (n.type === "heading") {
    const level = n.attrs?.level
    result.attrs = { level: level === 2 ? 2 : level === 3 ? 3 : 1 }
  }

  // F173 (AS-311): only `checked` (coerced to a real boolean) and `id`
  // (only if it's a non-empty string) ever survive — this is the same
  // "rebuild attrs from scratch, key by key" rule every other node above
  // follows, so an injected hostile key on a taskItem can't ride along.
  if (n.type === "taskItem") {
    const id = n.attrs?.id
    result.attrs = {
      checked: n.attrs?.checked === true,
      id: typeof id === "string" && id.length > 0 ? id : null,
    }
  }

  // F203 (AS-373): only `id` (a non-empty string) ever survives — `label`
  // is deliberately never accepted here either, same "rebuild attrs from
  // scratch" rule as every other node/mark, and the same reason it's
  // never written by mention-extension.ts's `command` in the first place:
  // the display name is always resolved live from `mentionSuggestions`,
  // never trusted from stored/untrusted JSON.
  if (n.type === "mention") {
    const id = n.attrs?.id
    result.attrs = { id: typeof id === "string" && id.length > 0 ? id : null }
  }

  if (Array.isArray(n.marks) && n.marks.length > 0) {
    const marks = n.marks
      .map(sanitiseMark)
      .filter((mark): mark is JSONContent => mark !== null)
    if (marks.length > 0)
      result.marks = marks as unknown as NonNullable<JSONContent["marks"]>
  }

  if (Array.isArray(n.content) && n.content.length > 0) {
    const content = n.content
      .map(sanitiseNode)
      .filter((child): child is JSONContent => child !== null)
    if (content.length > 0) result.content = content
  }

  return result
}

/**
 * Sanitises an untrusted Tiptap `JSONContent` document down to the
 * shared allow-list before it is ever handed to ProseMirror. Always
 * returns a well-formed `doc` node — hostile/malformed input degrades to
 * an empty document rather than throwing.
 */
export function sanitiseDocument(
  content: JSONContent | null | undefined,
): JSONContent {
  if (!content || typeof content !== "object") {
    return { type: "doc", content: [] }
  }
  const sanitised = sanitiseNode({ ...content, type: "doc" })
  if (!sanitised) return { type: "doc", content: [] }
  return sanitised
}

/**
 * Read-only render mode sharing the exact same extension set as
 * `RichTextEditor`, so display and edit can never diverge in how they
 * interpret the JSON schema (needed by F171). Content is always run
 * through `sanitiseDocument` first — never rendered as raw HTML, never
 * trusted just because it came from our own database.
 */
export function RichTextRenderer({
  content,
  className,
  "aria-label": ariaLabel = "Rich text content",
  onToggleTaskItem,
  mentionSuggestions,
}: RichTextRendererProps) {
  const safeContent = sanitiseDocument(content)

  // F310: same `deps`-driven recreation fix as `RichTextEditor` above — a
  // stale closure here is what produced the "persisted mentions render as
  // grey `Former member` after reload" symptom: freshly-loaded
  // `mentionSuggestions` arriving after this renderer's editor was first
  // constructed was never reflected in `resolveMentionDisplay`'s lookups
  // (called from the Mention extension's `renderHTML`/`renderText`, which
  // close over whatever `getMentionItems` returned at construction time),
  // so a mention id that WAS in the up-to-date list still rendered as
  // unresolved.
  // F314 (AS-373 residual): keyed on `id:label` pairs, NOT id alone -- see
  // the matching comment in `RichTextEditor` above. This is the exact path
  // the scrutiny pass reproduced the stale-name bug against (a member
  // rename never repainting an already-rendered chip in read-only comment/
  // description display), since an id-only key leaves the recreation key
  // unchanged when only the label changes.
  const mentionSuggestionsKey = (mentionSuggestions ?? [])
    .map((item) => `${item.id}:${item.label}`)
    .join(" ")
  const mentionsEnabled = mentionSuggestions !== undefined

  const editor = useEditor({
    extensions: sharedExtensions({
      // F121 (AS-074): read-only rendered content is the only place links
      // should be clickable — see `sharedExtensions`'s `linksClickable` doc.
      linksClickable: true,
      // F310: this closure is rebuilt (and the editor instance recreated)
      // whenever `mentionSuggestionsKey` changes below.
      getMentionItems: mentionsEnabled ? () => mentionSuggestions : undefined,
      // F173 (AS-311): read-only checkbox toggling. Optimistic by design —
      // this handler always accepts the click at the DOM level (returns
      // `true`) and hands off persistence to `onToggleTaskItem`; the
      // caller owns optimistic state + rollback via the `content` prop
      // (same pattern task-detail-sheet.tsx already uses for every other
      // field's editTask call), so a failed save is reflected here purely
      // by the next `content` prop update re-syncing the editor, not by
      // this component reaching back into the DOM after the fact.
      onReadOnlyChecked: onToggleTaskItem
        ? (node, checked) => {
            const itemId =
              typeof node.attrs.id === "string" && node.attrs.id.length > 0
                ? node.attrs.id
                : null
            // No stable id (e.g. content stored before this feature
            // shipped) — nothing to address server-side, so reject the
            // toggle rather than silently doing nothing.
            if (!itemId) return false
            void onToggleTaskItem(itemId, checked)
            return true
          }
        : undefined,
    }),
    content: safeContent,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "prose prose-sm dark:prose-invert max-w-none",
      },
    },
  }, [mentionSuggestionsKey])

  useEffect(() => {
    // F310: see the matching comment in `RichTextEditor` above — `editor`
    // can be a just-destroyed instance in the same commit that
    // `mentionSuggestionsKey` triggers a recreation.
    if (!editor || editor.isDestroyed) return
    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(safeContent)
    if (current !== next) {
      editor.commands.setContent(safeContent, { emitUpdate: false })
    }

  }, [safeContent, editor])

  if (!editor) return null

  return (
    <div className={cn("rich-text-renderer", className)}>
      <EditorContent editor={editor} />
    </div>
  )
}

export type { JSONContent }
