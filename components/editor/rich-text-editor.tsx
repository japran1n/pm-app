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
import {
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Link as LinkIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { transformPastedHtml } from "@/lib/editor/paste-rules"

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
function sharedExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
      },
    }),
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
}: RichTextEditorProps) {
  // F172 (AS-308): Cmd/Ctrl+Shift+V is the standard "paste as plain text"
  // override. Modifier state isn't exposed on the native `paste` event, so
  // the preceding keydown sets this ref; `handlePaste` below consumes and
  // clears it on the very next paste. A ref (not state) is used so setting
  // it never triggers a re-render mid-keystroke.
  const plainTextPasteRef = useRef(false)

  const editor = useEditor({
    extensions: sharedExtensions(),
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
      handleKeyDown: (_view, event) => {
        // AS-313: Escape blurs the editor but KEEPS the current buffer
        // content — Tiptap/ProseMirror has no built-in "revert on Escape"
        // behaviour, so simply blurring is non-destructive by default.
        // We only add the blur; the document is never reset here.
        if (event.key === "Escape") {
          editor?.commands.blur()
          onBlur?.()
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
    onUpdate: ({ editor: updatedEditor }) => {
      onChange?.(updatedEditor.getJSON())
    },
    onBlur: () => {
      onBlur?.()
    },
  })

  // Keep the editor in sync when the controlled `content` prop changes
  // from outside (e.g. loading a different task's description).
  useEffect(() => {
    if (!editor) return
    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(content ?? { type: "doc", content: [] })
    if (current !== next) {
      editor.commands.setContent(content ?? null, { emitUpdate: false })
    }
     
  }, [content, editor])

  useEffect(() => {
    if (!editor) return
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
  const normalised = trimmed.replace(/[ -\s]/g, "")
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
}: RichTextRendererProps) {
  const safeContent = sanitiseDocument(content)

  const editor = useEditor({
    extensions: sharedExtensions(),
    content: safeContent,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "prose prose-sm dark:prose-invert max-w-none",
      },
    },
  })

  useEffect(() => {
    if (!editor) return
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
