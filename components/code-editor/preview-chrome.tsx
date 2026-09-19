"use client";

// F069 (TH-231..TH-233) — Preview chrome: URL bar, reload, device presets.
//
// Wraps PreviewPane with a toolbar. Reuses the device width presets and
// control shape from `components/shared/site-preview-frame.tsx` per the
// feature's clarification note, rather than inventing new breakpoints.
// URLs are data (CLAUDE.md: "Data is mono") so the URL bar and the link
// indicator render in the mono font.
import { forwardRef, useState } from "react";

import {
  PreviewPane,
  type PreviewPaneHandle,
  type PreviewPaneProps,
} from "@/components/code-editor/preview-pane";

export type DevicePreset = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTH: Record<DevicePreset, string | undefined> = {
  desktop: undefined,
  tablet: "768px",
  mobile: "375px",
};

export interface PreviewChromeProps extends Omit<PreviewPaneProps, "className"> {
  /** The fetched site URL shown read-only in the toolbar. */
  url: string;
  /** Triggers a full recompose + refresh of the preview. */
  onReload?: () => void;
  /**
   * Last intercepted link click, shown in the toolbar's link indicator.
   * `PreviewPane` no longer exposes `onLinkClick` directly (see F060+),
   * so the host component listens for link clicks itself (e.g. via its
   * own message listener) and passes the most recent href down here.
   */
  lastLinkHref?: string | null;
  className?: string;
}

export const PreviewChrome = forwardRef<PreviewPaneHandle, PreviewChromeProps>(
  function PreviewChrome({ url, onReload, className, lastLinkHref, ...previewProps }, ref) {
    const [device, setDevice] = useState<DevicePreset>("desktop");

    const width = DEVICE_WIDTH[device];

    return (
      <div className={className ?? "flex h-full w-full flex-col"}>
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm">
          <input
            type="text"
            value={url}
            readOnly
            aria-label="Preview URL"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground"
          />
          <button
            type="button"
            onClick={onReload}
            aria-label="Reload preview"
            className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted/50"
          >
            Reload
          </button>
          <div
            role="group"
            aria-label="Device size"
            className="flex shrink-0 overflow-hidden rounded-md border border-border"
          >
            {(["desktop", "tablet", "mobile"] as DevicePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={device === preset}
                onClick={() => setDevice(preset)}
                className={
                  device === preset
                    ? "bg-secondary px-2 py-1 text-xs capitalize"
                    : "px-2 py-1 text-xs capitalize hover:bg-muted/50"
                }
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {lastLinkHref != null && (
          <div className="border-b border-border bg-muted/30 px-3 py-1 font-mono text-xs text-muted-foreground">
            Last link: {lastLinkHref}
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-auto">
          {width ? (
            <div
              className="mx-auto h-full transition-[width] duration-200"
              style={{ width }}
            >
              <PreviewPane {...previewProps} ref={ref} />
            </div>
          ) : (
            <div className="h-full w-full flex-1">
              <PreviewPane {...previewProps} ref={ref} />
            </div>
          )}
        </div>
      </div>
    );
  },
);
