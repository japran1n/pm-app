"use client";

// F260 (AS-505, AS-506): full-size preview for an image attachment, opened
// by clicking its thumbnail (components/task/attachment-list.tsx). Follows
// the same plain-overlay pattern as components/onboarding/tour.tsx (F253)
// rather than the shadcn/ui Dialog primitives (components/ui/dialog.tsx) —
// that dialog is base-ui's `<Dialog.Root>`, which owns its own portal +
// focus-trap + Escape handling; layering the shared escape-layer stack
// (lib/hooks/use-shortcut.ts) on top of a SECOND independent Escape handler
// risks double-handling and is genuinely harder to unit-test in jsdom (see
// tour.tsx's header comment / this mission's Playwright-broken note in
// NEXT-SESSION.md, which is why this mission's UI features are proven via
// jsdom+RTL, not live browser). A plain `role="dialog"` overlay + this
// component's OWN escape-layer registration is the simpler option that adds
// no new dependency and no second source of truth for "what's open" — same
// resolution rule this mission's clarifications apply to open questions.
//
// Signed-URL refresh: per the feature spec, a URL cached at initial page
// load (or even the thumbnail's own signed URL, minted whenever the task
// detail sheet mounted) must never be reused here — every open AND every
// next/previous navigation mints a fresh one via getAttachmentSignedUrl,
// since SIGNED_URL_TTL_SECONDS (1 hour, lib/actions/attachments.ts) can
// expire during a long-lived session.
//
// Thumbnail-size decision (recorded per the clarification's "Notes for
// clarification" resolution rule): the full-size image IS the preview
// image here — no server-side resize/transform pipeline was added. That
// would require a new dependency (e.g. Supabase Storage image
// transformations, which needs a Pro-tier project feature, or a
// sharp/next-image-style pipeline) which is out of scope for this pass.
// The "size-constrained" half of "thumbnail" is handled with pure CSS
// (`max-h-[80vh] max-w-full object-contain`) on both the inline thumbnail
// (already `object-cover` in a fixed 80x80 box, from the 2026-08-21
// follow-up) and this full-size view — a trivial, no-new-dependency
// approach, not a second source of truth for image sizing.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { getAttachmentSignedUrl } from "@/lib/actions/attachments";
import { Button } from "@/components/ui/button";
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";

export type LightboxImage = { id: string; fileName: string };

// Mints its own fresh signed URL on mount (matching AttachmentThumbnail's
// convention in attachment-list.tsx) — the parent remounts this via a
// `key={attachmentId}` on every open/next/previous, so "on mount" already
// means "every time the displayed attachment changes," with no in-effect
// state reset needed.
function LightboxImageBody({
  attachmentId,
  fileName,
}: {
  attachmentId: string;
  fileName: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getAttachmentSignedUrl(attachmentId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSignedUrl(result.signedUrl);
        setStatus("ready");
      } else {
        setStatus("error");
        toast.error(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  if (status === "loading") {
    return (
      <Loader2
        className="size-6 animate-spin text-white"
        aria-hidden="true"
      />
    );
  }

  if (status === "error" || !signedUrl) {
    return (
      <p className="text-mini text-white">Couldn&apos;t load this image.</p>
    );
  }

  return (
    // Signed Storage URLs are short-lived, same rationale as
    // AttachmentThumbnail's <img> in attachment-list.tsx.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={signedUrl}
      alt={fileName}
      className="max-h-[80vh] max-w-full rounded object-contain"
    />
  );
}

export function ImageLightbox({
  images,
  openId,
  onClose,
  onNavigate,
}: {
  /** All of the task's image attachments, in display order — next/previous
   * navigates within this list only (non-image attachments are never part
   * of it). */
  images: LightboxImage[];
  /** The id of the attachment currently shown, or null when closed. */
  openId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const open = openId !== null;
  const index = images.findIndex((image) => image.id === openId);
  const current = index >= 0 ? images[index] : null;

  // AS-506 ("focus restored to the trigger on close"): remember whatever
  // was focused (the thumbnail button that opened this lightbox) when it
  // opens, and give focus back to it once it closes.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // Move focus into the dialog itself so Escape/keyboard nav work
      // without requiring an extra Tab first.
      dialogRef.current?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current.focus();
      restoreFocusRef.current = null;
    }
  }, [open]);

  // AS-506: Escape closes the lightbox. Registered as a layer on the
  // shared stack (F244) so it cooperates with whatever else may be open
  // (e.g. the task detail sheet behind it) instead of a second, competing
  // document keydown listener.
  useEscapeLayer(open, onClose);

  function goPrevious() {
    if (index > 0) onNavigate(images[index - 1].id);
  }

  function goNext() {
    if (index >= 0 && index < images.length - 1) {
      onNavigate(images[index + 1].id);
    }
  }

  if (!open || !current) return null;

  const hasPrevious = index > 0;
  const hasNext = index >= 0 && index < images.length - 1;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
      onClick={(clickEvent) => {
        // Clicking the backdrop (not the dialog card itself) closes,
        // matching the shadcn Dialog's overlay-click-to-close convention.
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${current.fileName}`}
        tabIndex={-1}
        data-testid="image-lightbox"
        className="relative flex max-h-full max-w-full flex-col items-center gap-3 outline-none"
      >
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="absolute -top-2 -right-2 z-10"
          aria-label="Close preview"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>

        <div className="flex w-full items-center justify-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!hasPrevious}
            aria-label="Previous image"
            onClick={goPrevious}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>

          <div className="flex min-h-[200px] flex-1 items-center justify-center">
            {/* `key={current.id}` remounts this on every next/previous
                navigation, so each image gets its own fresh "loading"
                state and its own mint of getAttachmentSignedUrl on mount
                — same convention as AttachmentThumbnail in
                attachment-list.tsx, rather than resetting shared state
                inside an effect. */}
            <LightboxImageBody
              key={current.id}
              attachmentId={current.id}
              fileName={current.fileName}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!hasNext}
            aria-label="Next image"
            onClick={goNext}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        </div>

        <p className="max-w-full truncate text-mini text-white/80">
          {current.fileName}
        </p>
      </div>
    </div>
  );
}
