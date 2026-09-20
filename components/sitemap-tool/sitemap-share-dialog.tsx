"use client";

// Standalone Sitemap tool, Phase 2: the Share dialog opened from the
// editor's top bar. Deliberately simple per the clarified spec: shows the
// current share status, "Generate link" when there is none, and
// "Copy link" / "Revoke" when one exists. The public viewer route itself
// (/s/[token]) is a separate (already-landed) route group -- this dialog
// only manages the token's lifecycle.
import { useState, useTransition } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createSitemapShare, revokeSitemapShare } from "@/lib/actions/sitemaps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SitemapShareDialog({
  open,
  onOpenChange,
  sitemapId,
  initialToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sitemapId: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const shareUrl =
    token && typeof window !== "undefined" ? `${window.location.origin}/s/${token}` : token ? `/s/${token}` : null;

  function handleGenerate() {
    startTransition(async () => {
      const result = await createSitemapShare(sitemapId);
      if (result.ok) {
        setToken(result.data.token);
        toast.success("Share link created.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRevoke() {
    if (!token) return;
    startTransition(async () => {
      const result = await revokeSitemapShare(sitemapId, token);
      if (result.ok) {
        setToken(null);
        toast.success("Share link revoked.");
      } else {
        toast.error(result.error);
      }
    });
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share sitemap</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this sitemap. No sign-in required.
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl ?? ""} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label="Copy link">
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              </Button>
            </div>
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleRevoke}>
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Revoke link"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">No share link yet.</p>
            <Button type="button" disabled={isPending} onClick={handleGenerate}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Generating...
                </>
              ) : (
                "Generate link"
              )}
            </Button>
          </div>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="ghost">
                Close
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
