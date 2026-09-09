import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Good Guys 3.0: the Figma `tag` component is a 2px-radius chip on light-200
// with IBM Plex Mono 12/1.4 uppercase — not the pill this file shipped with.
// `rounded-4xl` therefore becomes `rounded-sm` (which now resolves off the
// system's 2px --radius) and the label picks up the mono tag-text step.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-border bg-transparent px-2 py-0.5 text-xs font-normal whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-border bg-transparent text-foreground [a]:hover:bg-[#ffffff0d]",
        secondary: "border-border bg-transparent text-foreground [a]:hover:bg-[#ffffff0d]",
        destructive:
          "border-destructive/40 bg-transparent text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/10",
        outline:
          "border-border bg-transparent text-foreground [a]:hover:bg-[#ffffff0d] [a]:hover:text-muted-foreground",
        ghost:
          "border-transparent bg-transparent hover:bg-[#ffffff0d] hover:text-muted-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
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
