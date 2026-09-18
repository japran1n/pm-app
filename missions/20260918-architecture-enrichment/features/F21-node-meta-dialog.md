# F21 — `<NodeMetaDialog>` komponenta

**Status:** [CLARIFIED]
**Estimate:** 40 min
**Depends on:** F13 (node-meta actions), F15 (toggle)

## Task

Napravi `components/architecture/node-meta-dialog.tsx` — dialog za unos copy brief polja po čvoru.

## Polja

- Intent (textarea, max 1000)
- Audience (input, max 500)
- Primary CTA (input, max 200)
- Tone (input, max 200)
- Keywords (comma-separated input koji se konvertuje u tagove, max 30)
- Copy status (Select: not_started, brief_ready, drafted, in_review, approved)

## Implementacija

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";

import { setNodeMeta } from "@/lib/actions/architecture";
import type { NodeMeta } from "@/lib/architecture/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const COPY_STATUS_LABELS = {
  not_started: "Not started",
  brief_ready: "Brief ready",
  drafted: "Drafted",
  in_review: "In review",
  approved: "Approved",
} as const;

export function NodeMetaDialog({
  taskId,
  taskTitle,
  meta,
  open,
  onOpenChange,
}: {
  taskId: string;
  taskTitle: string;
  meta: NodeMeta | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [intent, setIntent] = useState(meta?.intent ?? "");
  const [audience, setAudience] = useState(meta?.audience ?? "");
  const [primaryCta, setPrimaryCta] = useState(meta?.primaryCta ?? "");
  const [tone, setTone] = useState(meta?.tone ?? "");
  const [keywords, setKeywords] = useState<string[]>(meta?.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [copyStatus, setCopyStatus] = useState<NodeMeta["copyStatus"]>(
    meta?.copyStatus ?? "not_started"
  );

  function addKeyword(raw: string) {
    const tags = raw
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0);
    setKeywords((prev) => {
      const merged = [...new Set([...prev, ...tags])].slice(0, 30);
      return merged;
    });
    setKeywordInput("");
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await setNodeMeta(taskId, {
        intent: intent || null,
        audience: audience || null,
        primaryCta: primaryCta || null,
        tone: tone || null,
        keywords,
        copyStatus,
      });
      if (result.success) {
        router.refresh();
        onOpenChange(false);
      } else {
        toast.error(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate text-base">{taskTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Intent</Label>
            <Textarea
              placeholder="What should this page/section accomplish?"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              maxLength={1000}
              rows={3}
              className="resize-none text-sm"
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Audience</Label>
            <Input
              placeholder="Who is this page for?"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              maxLength={500}
              className="text-sm"
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Primary CTA</Label>
            <Input
              placeholder="e.g. Book a demo"
              value={primaryCta}
              onChange={(e) => setPrimaryCta(e.target.value)}
              maxLength={200}
              className="text-sm"
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Tone</Label>
            <Input
              placeholder="e.g. Direct, concrete, no hype"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              maxLength={200}
              className="text-sm"
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Keywords</Label>
            <div className="flex flex-wrap gap-1">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-xs"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="text-muted-foreground hover:text-foreground"
                    disabled={isPending}
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              placeholder="Add keywords, comma-separated"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  if (keywordInput.trim()) addKeyword(keywordInput);
                }
              }}
              onBlur={() => {
                if (keywordInput.trim()) addKeyword(keywordInput);
              }}
              className="text-sm"
              disabled={isPending || keywords.length >= 30}
            />
            <p className="text-xs text-muted-foreground">{keywords.length}/30</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Copy status</Label>
            <Select
              value={copyStatus}
              onValueChange={(v) => setCopyStatus(v as NodeMeta["copyStatus"])}
              disabled={isPending}
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COPY_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-sm">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isPending}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## Definition of done

- [ ] Dialog postoji sa svim 6 polja
- [ ] Keywords input: Enter/comma dodaje tag, X uklanja, max 30
- [ ] Save poziva `setNodeMeta` i zatvara dialog na uspeh
- [ ] Nema hex boja, nema novih senki
- [ ] TypeScript build prolazi
