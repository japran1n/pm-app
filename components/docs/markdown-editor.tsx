"use client";

// MarkdownEditor (W4, docs/docs-system-plan.md) — the doc editor's client
// component. Storage format is a plain Markdown string (the plan's
// "Storage format: čist Markdown string" decision) — Tiptap is only used as
// the WYSIWYG editing surface, converting between its internal JSON document
// and Markdown via the `tiptap-markdown` extension (`editor.storage.markdown
// .getMarkdown()`).
//
// Package name deviation from the spec: the spec names
// `@tiptap/extension-markdown`, but that package does not exist on npm
// (confirmed via `npm view` — 404). The real, actively maintained community
// extension providing this exact `Markdown` extension / `storage.markdown
// .getMarkdown()` API for Tiptap 3 is `tiptap-markdown` (v0.9.0, peer dep
// `@tiptap/core: ^3.0.1`, verified via `npm view tiptap-markdown
// peerDependencies`). Installed and used instead — see handoff for details.
//
// Client-only by design (mirrors components/editor/rich-text-editor.tsx):
// `useEditor` touches the DOM, so the Server Component page that renders
// this must use a dynamic import with `{ ssr: false }`.
//
// Both a named export (`MarkdownEditor`, the shape this feature's spec
// requires: `{ docId, initialTitle, initialContent }`) and a default export
// are provided — `workspaceSlug`/`projectId` are accepted as optional/unused
// props so a project-scoped consumer (W5, built in parallel against this
// same file) can pass them without a type error; this component itself
// never needs them since the breadcrumb/scope is resolved by the Server
// Component page, not here.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Italic,
  Code,
  Code2,
  List,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Loader2,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateDoc } from "@/lib/actions/docs";

const AUTOSAVE_DEBOUNCE_MS = 800;

export type MarkdownEditorProps = {
  docId: string;
  initialTitle: string;
  initialContent: string;
  /** Unused here (breadcrumb/scope is resolved by the page) — accepted so
   * a project-scoped page can pass it without a type error. */
  workspaceSlug?: string;
  /** Unused here — see above. */
  projectId?: string;
};

export function MarkdownEditor({
  docId,
  initialTitle,
  initialContent,
}: MarkdownEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Debounced auto-save (plan: 800ms after the user stops typing, no manual
  // Save button). A plain setTimeout ref is used rather than pulling in a
  // debounce library — this codebase has no `use-debounce`/lodash debounce
  // dependency anywhere else, and a single timer ref is the simplest thing
  // that satisfies "only fire 800ms after the last change".
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const scheduleSave = useCallback(
    (nextTitle: string, nextContent: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(async () => {
        setStatus("saving");
        const result = await updateDoc(docId, nextTitle, nextContent);
        setStatus(result.error ? "error" : "saved");
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [docId],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Document content",
        class: "prose dark:prose-invert max-w-none px-1 py-2 outline-none",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const markdown = (
        updatedEditor.storage as unknown as { markdown: { getMarkdown(): string } }
      ).markdown.getMarkdown();
      scheduleSave(titleRef.current, markdown);
    },
  });

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextTitle = event.target.value;
    setTitle(nextTitle);
    if (!editor) return;
    const markdown = (
      editor.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();
    scheduleSave(nextTitle, markdown);
  }

  if (!editor) return null;

  async function handleAiEdit() {
    if (!editor || !aiInstruction.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const markdown = (
        editor.storage as unknown as { markdown: { getMarkdown(): string } }
      ).markdown.getMarkdown();
      const res = await fetch("/api/docs/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: markdown,
          instruction: aiInstruction,
        }),
      });
      if (!res.ok) throw new Error("AI edit failed");
      const { result } = await res.json();
      editor.commands.setContent(result);
      setAiOpen(false);
      setAiInstruction("");
    } catch {
      setAiError("Something went wrong, try again.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <input
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled"
          className="w-full border-none bg-transparent text-3xl font-bold outline-none"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {status === "saving" && "Saving..."}
          {status === "saved" && "Saved"}
          {status === "error" && "Failed to save"}
        </span>
      </div>

      <Toolbar
        editor={editor}
        aiOpen={aiOpen}
        setAiOpen={setAiOpen}
        aiInstruction={aiInstruction}
        setAiInstruction={setAiInstruction}
        aiLoading={aiLoading}
        aiError={aiError}
        onAiEdit={handleAiEdit}
      />

      <EditorContent editor={editor} />
    </div>
  );
}

export default MarkdownEditor;

type SaveStatus = "idle" | "saving" | "saved" | "error";

function Toolbar({
  editor,
  aiOpen,
  setAiOpen,
  aiInstruction,
  setAiInstruction,
  aiLoading,
  aiError,
  onAiEdit,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
  aiInstruction: string;
  setAiInstruction: (value: string) => void;
  aiLoading: boolean;
  aiError: string | null;
  onAiEdit: () => void;
}) {
  const items: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
  }> = [
    {
      label: "Heading 1",
      icon: Heading1,
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      icon: Heading2,
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bold",
      icon: Bold,
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Code",
      icon: Code,
      onClick: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: "Code block",
      icon: Code2,
      onClick: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Blockquote",
      icon: Quote,
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2"
    >
      {items.map(({ label, icon: Icon, onClick }) => (
        <Button
          key={label}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          onClick={onClick}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Popover open={aiOpen} onOpenChange={setAiOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="AI Edit"
              title="AI Edit"
            >
              <Sparkles className="size-3.5" />
            </Button>
          }
        />
        <PopoverContent className="flex w-72 flex-col gap-2">
          <Textarea
            placeholder="Describe what to change..."
            value={aiInstruction}
            onChange={(event) => setAiInstruction(event.target.value)}
            rows={3}
          />
          {aiError && <p className="text-xs text-destructive">{aiError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAiOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onAiEdit}
              disabled={aiLoading || !aiInstruction.trim()}
            >
              {aiLoading ? "Applying..." : "Apply"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
