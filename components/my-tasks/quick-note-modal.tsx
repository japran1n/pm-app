"use client";

// Global "Quick note" capture: mounted once in the workspace layout. Adds
// items through the same `createPersonalTodo` server action the Personal
// to-dos card uses; that action revalidates the dashboard/my-tasks paths,
// and router.refresh() pushes fresh `initialTodos` into any mounted
// PersonalTodoList (which already re-syncs when that prop changes).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { createPersonalTodo } from "@/lib/actions/personal-todos";
import {
  isMacPlatform,
  isQuickNoteShortcut,
  splitQuickNoteLines,
} from "@/lib/personal-todos/quick-note-shortcut";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Added = { key: number; title: string };

export function QuickNoteModal({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [added, setAdded] = useState<Added[]>([]);
  const [pending, setPending] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const addedCountRef = useRef(0);

  function handleOpenChange(next: boolean) {
    if (!next) {
      const count = addedCountRef.current;
      if (count > 0) {
        toast.success(`${count} added to Personal to-dos`);
        router.refresh();
      }
      addedCountRef.current = 0;
      setAdded([]);
      setValue("");
    }
    setOpen(next);
  }

  // Latest handler in a ref so the document listener is registered once.
  const toggleRef = useRef(() => {});
  useEffect(() => {
    toggleRef.current = () => handleOpenChange(!open);
  });

  useEffect(() => {
    const isMac = isMacPlatform();
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || !isQuickNoteShortcut(e, isMac)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleRef.current();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  async function addTitles(titles: string[]) {
    if (titles.length === 0) return;
    setPending((n) => n + titles.length);
    for (const title of titles) {
      const result = await createPersonalTodo({ workspaceId, title });
      setPending((n) => n - 1);
      if (!result.ok) {
        toast.error(result.error);
        continue;
      }
      addedCountRef.current += 1;
      keyRef.current += 1;
      const key = keyRef.current;
      setAdded((current) => [...current, { key, title }]);
    }
    router.refresh();
  }

  function submit() {
    const titles = splitQuickNoteLines(value);
    if (titles.length === 0) return;
    setValue("");
    inputRef.current?.focus();
    void addTitles(titles);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={inputRef}
        className="gap-3 p-4 shadow-lg sm:max-w-md"
      >
        <div className="flex items-center justify-between">
          <DialogTitle className="text-sm font-medium">Quick note</DialogTitle>
          <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            Esc
          </kbd>
        </div>

        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!/\r?\n/.test(text)) return;
            e.preventDefault();
            const lines = splitQuickNoteLines(value + text);
            setValue("");
            void addTitles(lines);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Add a reminder..."
          aria-label="Quick note"
          className="h-9"
        />

        {(added.length > 0 || pending > 0) && (
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto" aria-live="polite">
            {added.map((item) => (
              <li key={item.key} className="flex items-center gap-2 text-sm">
                <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{item.title}</span>
              </li>
            ))}
            {pending > 0 && (
              <li className="font-mono text-xs text-muted-foreground">Adding {pending}…</li>
            )}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          <span className="font-mono">Enter</span> add · <span className="font-mono">Esc</span> close
        </p>
      </DialogContent>
    </Dialog>
  );
}
