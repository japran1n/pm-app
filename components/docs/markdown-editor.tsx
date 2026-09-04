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
// are provided — `workspaceSlug` is accepted as an optional/unused prop so
// a project-scoped consumer (W5, built in parallel against this same file)
// can pass it without a type error (breadcrumb/scope is resolved by the
// Server Component page, not here). `projectId` WAS unused at first but is
// now read directly by this component (F008, AS-019): it gates whether the
// header's "Request client approval" trigger renders at all, since only a
// project-scoped doc has a project to attach an approval_requests row to.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateDoc, setDocKind } from "@/lib/actions/docs";
import { DocClientVisibilityToggle } from "@/components/docs/doc-client-visibility-toggle";
import { docKindSchema, type SetDocKindInput } from "@/lib/validation/project-site";
import { toast } from "sonner";
// F008 (missions/20260903-portal, AS-019): the doc header's "Request
// client approval" entry point. Only meaningful for a PROJECT-scoped doc —
// approval_requests.project_id is required, and a workspace-level doc
// (projectId undefined here) has no project to attach the approval to —
// so it's rendered only when this component actually receives one.
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import Link from "next/link";
import { Eye } from "lucide-react";

const AUTOSAVE_DEBOUNCE_MS = 800;

const DOC_KIND_LABELS: Record<SetDocKindInput["kind"], string> = {
  note: "Note",
  training: "Training",
  process: "Process",
  handover: "Handover",
};

export type MarkdownEditorProps = {
  docId: string;
  initialTitle: string;
  initialContent: string;
  /** Unused here (breadcrumb/scope is resolved by the page) — accepted so
   * a project-scoped page can pass it without a type error. */
  workspaceSlug?: string;
  /** F024 (missions/20260903-portal, AS-052): gates the "View as client"
   * shortcut to owner/admin, mirroring `startClientPreview`'s own
   * server-side re-check. Undefined (a caller that hasn't been updated)
   * simply omits the shortcut, same "safe default hides the affordance"
   * convention every other optional prop in this file already follows. */
  currentUserRole?: "owner" | "admin" | "member" | "viewer" | "guest" | "client";
  /** F008 (AS-019): when set, this doc belongs to a project and the
   * header's "Request client approval" trigger is rendered — a
   * workspace-level doc (undefined here) has no project to attach an
   * approval to, so the trigger is simply omitted rather than disabled. */
  projectId?: string;
  /** F022 (AS-051): whether this doc is currently shared to the client
   * portal's guides list, and what kind of guide it is. Undefined for a
   * caller that hasn't been updated to pass them (defaults keep the
   * header rendering exactly as before: hidden toggle, no kind select) —
   * both project doc pages below always pass real values. */
  initialClientVisible?: boolean;
  initialDocKind?: SetDocKindInput["kind"];
};

export function MarkdownEditor({
  docId,
  initialTitle,
  initialContent,
  workspaceSlug,
  projectId,
  initialClientVisible,
  initialDocKind,
  currentUserRole,
}: MarkdownEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [docKind, setDocKindState] = useState<SetDocKindInput["kind"]>(
    initialDocKind ?? "note",
  );
  const [isKindPending, startKindTransition] = useTransition();

  function handleKindChange(value: string | null) {
    const parsed = docKindSchema.safeParse(value);
    if (!parsed.success) return;
    const previous = docKind;
    setDocKindState(parsed.data);
    startKindTransition(async () => {
      const result = await setDocKind(docId, parsed.data);
      if (!result.ok) {
        setDocKindState(previous);
        toast.error(result.error);
      }
    });
  }

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
        {projectId && (
          <>
            <Select value={docKind} onValueChange={handleKindChange} disabled={isKindPending}>
              <SelectTrigger className="w-32 shrink-0" aria-label="Document kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {docKindSchema.options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {DOC_KIND_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DocClientVisibilityToggle
              docId={docId}
              clientVisible={initialClientVisible ?? false}
            />
            <RequestApprovalDialog
              projectId={projectId}
              subject={{ subjectType: "doc", subjectId: docId, defaultTitle: title }}
            />
            {/* F024 (missions/20260903-portal, AS-052): "View as client" --
                same shortcut and same owner/admin-only gate as
                task-detail-sheet.tsx's own copy; see that component's
                doc comment. Requires the doc to already be client-visible
                for the same reason. */}
            {workspaceSlug &&
              initialClientVisible &&
              (currentUserRole === "owner" || currentUserRole === "admin") && (
                <Link
                  href={`/w/${workspaceSlug}/preview-as-client?projectId=${projectId}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  View as client
                </Link>
              )}
          </>
        )}
      </div>

      <Toolbar editor={editor} />

      <EditorContent editor={editor} />
    </div>
  );
}

export default MarkdownEditor;

type SaveStatus = "idle" | "saving" | "saved" | "error";

function Toolbar({
  editor,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
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
    </div>
  );
}
