import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Supabase design system: badges are 1px-border, 10%-tint pills — uppercase,
// 9px, tracking-[0.07em] — colour is carried entirely via `currentColor`
// (`border-current/20`, `bg-current/10`) so a single `text-*` class drives
// border, fill, and label colour together. No colour-dot indicator.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-current/20 bg-current/10 px-[5.5px] py-[3px] text-[9px] font-medium tracking-[0.07em] whitespace-nowrap uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "text-foreground",
        secondary: "text-muted-foreground",
        destructive: "text-destructive focus-visible:ring-destructive/20",
        outline: "border-border bg-transparent text-foreground",
        ghost: "border-transparent bg-transparent text-muted-foreground",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
        warning: "text-warning",
        success: "text-brand",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
