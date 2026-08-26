"use client";

import type { ComponentProps } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ButtonVariant = NonNullable<
  Parameters<typeof buttonVariants>[0]
>["variant"];

// UX-06: icon-only controls across the app (sidebar bell, sign-out, board
// toolbar buttons) already carry an `aria-label` for screen readers — 136
// call sites do — but almost none show that same label to a sighted mouse
// user. `label` is required here specifically so it is impossible to wire
// up one without the other: it becomes both the `aria-label` and the
// tooltip text from a single string, one prop.
export function IconButton({
  label,
  side = "bottom",
  variant = "ghost",
  size = "icon-sm",
  className,
  children,
  ...props
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  variant?: ButtonVariant;
  size?: "icon" | "icon-sm" | "icon-lg" | "icon-xs";
} & Omit<ComponentProps<"button">, "aria-label">) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={label}
          className={cn(buttonVariants({ variant, size }), className)}
          {...props}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
