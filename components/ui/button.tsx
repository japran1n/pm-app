import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Supabase Design System button anatomy: rounded-md, a border on every
// variant (including primary), duration-200 transitions, and a subtle
// press scale. See CLAUDE.md "Interaction rules" / "Shadow rule".
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-all duration-200 outline-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-secondary border-border text-secondary-foreground hover:bg-accent hover:border-border-control-hover",
        primary: "bg-primary border-transparent text-primary-foreground hover:bg-primary/90",
        outline:
          "bg-transparent border-border text-foreground hover:bg-accent hover:border-border-control-hover",
        ghost:
          "bg-transparent border-transparent text-foreground hover:bg-accent hover:border-transparent",
        dashed:
          "bg-transparent border-dashed border-border text-foreground hover:border-border-control-hover hover:bg-accent",
        destructive:
          "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 hover:border-destructive",
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
        // Backward-compat: old Linear callers pass `secondary` expecting the
        // subtle/default look. Alias it to `default`.
        secondary:
          "bg-secondary border-border text-secondary-foreground hover:bg-accent hover:border-border-control-hover",
      },
      size: {
        tiny: "h-[26px] px-2.5 text-xs",
        sm: "h-[34px] px-3 text-sm",
        default: "h-[38px] px-4 text-sm",
        lg: "h-[42px] px-5 text-sm",
        xl: "h-[50px] px-6 text-base",
        icon: "h-[38px] w-[38px] p-0",
        "icon-sm": "h-[34px] w-[34px] p-0",
        "icon-tiny": "h-[26px] w-[26px] p-0",
        // Backward-compat aliases for old Linear size scale.
        xs: "h-[26px] px-2.5 text-xs",
        "icon-xs": "h-[26px] w-[26px] p-0",
        "icon-lg": "h-[42px] w-[42px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
