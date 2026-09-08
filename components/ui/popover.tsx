"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        // Popovers (unlike Select/Dropdown/Dialog, which never coexist with
        // the global first-run onboarding tour on the same interaction) are
        // opened directly by a user click on ordinary page content -- and
        // the tour's own unanchored "welcome" step (components/onboarding/
        // tour.tsx) renders a `position: fixed; zIndex: 70` card centered
        // on the viewport whenever its target selector isn't present on the
        // current page (e.g. the calendar, which has no `data-tour`
        // targets). At the previous `z-50`, that tour card visually AND
        // functionally sat on top of an open Popover (confirmed live: the
        // calendar block create/edit popover's own submit button, itself
        // correctly positioned and not covered by anything per DOM order,
        // received zero click/pointerdown events in a real browser because
        // the higher-stacked tour card -- inert or not -- still wins the
        // browser's hit-test at that pixel and swallows the click instead
        // of letting it fall through). `z-[80]` puts an actively-open
        // Popover's own content above that z-70 tour card so a user
        // interacting with a popover is never blocked by a stale
        // background tour tooltip.
        className="isolate z-[80]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-[80] flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover border border-border p-2.5 text-mini text-popover-foreground shadow-[0px_4px_24px_rgba(0,0,0,0.18)] outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-mini", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
