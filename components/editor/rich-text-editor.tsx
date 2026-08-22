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

import { useEffect, useReducer } from "react"
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
        // NOTE: a submit shortcut (documented in F245) will hook in here
        // once that feature exists — intentionally not implemented yet.
        return false
      },
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
  /** Tiptap JSON document to render read-only. */
  content?: JSONContent | null
  className?: string
  "aria-label"?: string
}

/**
 * Read-only render mode sharing the exact same extension set as
 * `RichTextEditor`, so display and edit can never diverge in how they
 * interpret the JSON schema (needed by F171).
 */
export function RichTextRenderer({
  content,
  className,
  "aria-label": ariaLabel = "Rich text content",
}: RichTextRendererProps) {
  const editor = useEditor({
    extensions: sharedExtensions(),
    content: content ?? undefined,
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
    const next = JSON.stringify(content ?? { type: "doc", content: [] })
    if (current !== next) {
      editor.commands.setContent(content ?? null, { emitUpdate: false })
    }
     
  }, [content, editor])

  if (!editor) return null

  return (
    <div className={cn("rich-text-renderer", className)}>
      <EditorContent editor={editor} />
    </div>
  )
}

export type { JSONContent }
