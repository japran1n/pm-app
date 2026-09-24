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
import { useRouter } from "next/navigation";
// F009: announces this doc's title upward via the SAME "leaf announces
// itself upward" context ProjectBreadcrumb already uses
// (components/project/project-breadcrumb.tsx).
import { useSetBreadcrumb } from "@/components/nav/breadcrumb-context";
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
  Download,
  Upload,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateDoc, setDocKind, setDocRelevantFrom } from "@/lib/actions/docs";
import { DocClientVisibilityToggle } from "@/components/docs/doc-client-visibility-toggle";
import { DocLinksEditor } from "@/components/docs/doc-links-editor";
import {
  docKindSchema,
  howWeWorkDocKinds,
  relevantFromSchema,
  type RelevantFrom,
  type SetDocKindInput,
} from "@/lib/validation/project-site";
import type { DocLink } from "@/lib/queries/docs";
import { toast } from "sonner";
// F008 (missions/20260903-portal, AS-019): the doc header's "Request
// client approval" entry point. Only meaningful for a PROJECT-scoped doc —
// approval_requests.project_id is required, and a workspace-level doc
// (projectId undefined here) has no project to attach the approval to —
// so it's rendered only when this component actually receives one.
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useMembership } from "@/components/auth/membership-provider";

const AUTOSAVE_DEBOUNCE_MS = 800;

const DOC_KIND_LABELS: Record<SetDocKindInput["kind"], string> = {
  note: "Note",
  training: "Training",
  process: "Process",
  handover: "Handover",
  onboarding: "Onboarding",
  feedback: "Feedback",
  portal_guide: "Portal guide",
  brief: "Brief",
};

// F114 (client-portal-phase-2-plan.md, items E-H): the "when does this
// become relevant" selector, only meaningful for a "How we work" kind
// (onboarding/feedback/portal_guide/handover) — a plain note or training
// guide has no equivalent concept, so the selector is hidden for those.
const RELEVANT_FROM_LABELS: Record<RelevantFrom, string> = {
  always: "Always",
  kickoff: "Project start",
  ongoing: "Throughout",
  launch: "At launch",
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
  /** F114: null (the DB's "always relevant") maps to the app-level
   * "always" enum member right at this prop boundary — see
   * relevantFromSchema's own comment. Undefined (a caller that hasn't
   * been updated) hides the selector entirely, same convention as
   * initialClientVisible/initialDocKind above. */
  initialRelevantFrom?: "kickoff" | "ongoing" | "launch" | null;
  /** F114: this doc's video/document link previews. Undefined hides the
   * links editor, same convention as the props above. */
  initialDocLinks?: DocLink[];
  /** P2-2: the `updated_at` timestamp the server returned when this doc
   * was loaded. When provided, updateDoc uses optimistic concurrency — if
   * another session has saved since this load, the save returns
   * { conflict: true } and the editor shows a reload banner instead of
   * silently overwriting. Optional so callers that haven't been updated
   * yet continue to work without a concurrency guard. */
  initialUpdatedAt?: string;
};

export function MarkdownEditor({
  docId,
  initialTitle,
  initialContent,
  workspaceSlug,
  projectId,
  initialClientVisible,
  initialDocKind,
  initialRelevantFrom,
  initialDocLinks,
  currentUserRole,
  initialUpdatedAt,
}: MarkdownEditorProps) {
  const clientPreviewEnabled = useMembership()?.clientPreviewEnabled ?? false;
  const router = useRouter();
  // P2-2: tracks the last-known updated_at so updateDoc can use optimistic
  // concurrency. Refreshed to the DB-returned value after every successful
  // save, so back-to-back autosaves don't falsely conflict with each other
  // (the trigger bumps updated_at on every write, so saving the doc itself
  // changes the timestamp we need to match on the next save).
  const lastKnownUpdatedAtRef = useRef<string | undefined>(initialUpdatedAt);
  const [showConflictBanner, setShowConflictBanner] = useState(false);

  const [title, setTitle] = useState(initialTitle);
  // F009 (AS-061): keeps the header breadcrumb AND the docs assistant
  // sidebar's context bar in sync with the live (possibly-unsaved) title
  // as the user types, not just `initialTitle` — same live-title
  // responsiveness the title textarea below already has.
  //
  // F035 (M2 review minor, same file): announcing `title` directly here
  // fired `setSlot` on every keystroke in the title field, re-rendering
  // BreadcrumbProvider (and everything under it, including the whole
  // workspace shell) once per character. Debounced the same way this
  // file's own autosave already is (`AUTOSAVE_DEBOUNCE_MS`) — the
  // breadcrumb/context-bar title only needs to settle a beat after typing
  // stops, not track every keystroke.
  const [debouncedTitle, setDebouncedTitle] = useState(initialTitle);
  const titleAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (titleAnnounceTimerRef.current) {
      clearTimeout(titleAnnounceTimerRef.current);
    }
    titleAnnounceTimerRef.current = setTimeout(() => {
      setDebouncedTitle(title);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (titleAnnounceTimerRef.current) {
        clearTimeout(titleAnnounceTimerRef.current);
      }
    };
  }, [title]);
  // F035: named "doc" slot (see breadcrumb-context.tsx's `SLOT_ORDER`) so
  // this composes with `ProjectBreadcrumb`'s "project" slot instead of
  // clobbering it on `/projects/<id>/docs/<docId>`.
  useSetBreadcrumb([{ label: debouncedTitle || "Untitled" }], "doc");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [docKind, setDocKindState] = useState<SetDocKindInput["kind"]>(
    initialDocKind ?? "note",
  );
  const [isKindPending, startKindTransition] = useTransition();
  const [relevantFrom, setRelevantFromState] = useState<RelevantFrom>(
    initialRelevantFrom ?? "always",
  );
  const [isRelevantFromPending, startRelevantFromTransition] = useTransition();

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

  function handleRelevantFromChange(value: string | null) {
    const parsed = relevantFromSchema.safeParse(value);
    if (!parsed.success) return;
    const previous = relevantFrom;
    setRelevantFromState(parsed.data);
    startRelevantFromTransition(async () => {
      const result = await setDocRelevantFrom(docId, parsed.data);
      if (!result.ok) {
        setRelevantFromState(previous);
        toast.error(result.error);
      }
    });
  }

  const isHowWeWorkKind = (howWeWorkDocKinds as readonly string[]).includes(docKind);

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
        // P2-2: pass the current guard value; updateDoc returns conflict:true
        // if another session saved in the meantime, or newUpdatedAt on success.
        const result = await updateDoc(
          docId,
          nextTitle,
          nextContent,
          lastKnownUpdatedAtRef.current,
        );
        if (result.conflict) {
          setStatus("idle");
          setShowConflictBanner(true);
        } else if (result.error) {
          setStatus("error");
        } else {
          setStatus("saved");
          // Refresh the guard value so the next autosave matches the new row.
          if (result.newUpdatedAt) {
            lastKnownUpdatedAtRef.current = result.newUpdatedAt;
          }
        }
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
        class: "prose max-w-none px-1 py-2 outline-none",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const markdown = (
        updatedEditor.storage as unknown as { markdown: { getMarkdown(): string } }
      ).markdown.getMarkdown();
      scheduleSave(titleRef.current, markdown);
    },
  });

  function handleTitleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextTitle = event.target.value;
    setTitle(nextTitle);
    if (!editor) return;
    const markdown = (
      editor.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();
    scheduleSave(nextTitle, markdown);
  }

  // Auto-grow the title textarea to fit its (possibly multi-line) content
  // instead of clipping/scrolling long titles horizontally.
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const node = titleTextareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [title]);

  // Export/import as Markdown (.md) — the storage format is already a
  // plain Markdown string (see this file's top comment), so export is a
  // direct download of the current live content and import is a direct
  // `setContent` + save, no conversion layer needed either direction.
  const importInputRef = useRef<HTMLInputElement | null>(null);

  function currentMarkdown() {
    return (
      editor?.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();
  }

  function handleExport() {
    if (!editor) return;
    const markdown = currentMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const fileName = `${title.trim() || "Untitled"}.md`;
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editor) return;

    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      toast.error("Please choose a .md (Markdown) file.");
      return;
    }

    try {
      const text = await file.text();
      editor.commands.setContent(text);
      const markdown = currentMarkdown();
      scheduleSave(titleRef.current, markdown);
      toast.success("Imported document content.");
    } catch {
      toast.error("Couldn't read that file. Please try again.");
    }
  }

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* P2-2: concurrent-edit conflict banner — shown when another session
          saved the doc after this one loaded it. A reload fetches the latest
          version; dismissing hides the banner without reloading (the user's
          unsaved changes remain in the editor). */}
      {showConflictBanner && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span>
            This document was edited in another window. Reload to see the latest version.
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => router.refresh()}
            >
              Reload
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowConflictBanner(false)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <textarea
          ref={titleTextareaRef}
          value={title}
          onChange={handleTitleChange}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          placeholder="Untitled"
          rows={1}
          className="min-w-0 flex-1 resize-none overflow-hidden whitespace-pre-wrap break-words border-none bg-transparent text-3xl font-bold outline-none"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {status === "saving" && "Saving..."}
          {status === "saved" && "Saved"}
          {status === "error" && "Failed to save"}
        </span>
        <input
          ref={importInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={handleImportFileChange}
        />
        <Button type="button" variant="ghost" size="sm" onClick={handleImportClick}>
          <Upload className="size-3.5" aria-hidden="true" />
          Import .md
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleExport}>
          <Download className="size-3.5" aria-hidden="true" />
          Export .md
        </Button>
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
            {isHowWeWorkKind && (
              <Select
                value={relevantFrom}
                onValueChange={handleRelevantFromChange}
                disabled={isRelevantFromPending}
              >
                <SelectTrigger className="w-36 shrink-0" aria-label="Relevant from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {relevantFromSchema.options.map((value) => (
                    <SelectItem key={value} value={value}>
                      {RELEVANT_FROM_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
              clientPreviewEnabled &&
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

      {isHowWeWorkKind && initialDocLinks !== undefined && (
        <DocLinksEditor docId={docId} initialLinks={initialDocLinks} />
      )}

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
