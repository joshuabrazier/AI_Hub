import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        // -------------------------------------------------------------
        // STATUS BADGES, THROUGH THE TOKENS.
        //
        // These were `emerald-200/50/700` and `amber-200/50/700` with a
        // `dark:` triple each - six hardcoded Tailwind palette classes per
        // variant, in the one primitive every status badge in the app goes
        // through. Off-palette in a repo whose rule is that rebranding is
        // one file, and off-temperature too: Tailwind's emerald and amber
        // are neutral-based where these neutrals carry a teal bias.
        //
        // NO `dark:` VARIANTS ANY MORE, and that is the tell that this is
        // right rather than merely renamed. The tokens are themed, so one
        // declaration is correct in both themes - the old version had to
        // state the dark case because a literal shade cannot know.
        //
        // WARNING USES THE CAUTION FAMILY THAT ALREADY EXISTED. The palette
        // defines --data-caution as "look at this", explicitly kept apart
        // from --destructive, and nothing was using it for the thing it
        // describes. It is a rose rather than an amber, on purpose: the note
        // beside --data-cost says the amber it replaced "kept saying" a
        // normal cost was a warning, and one caution colour is the point.
        // -------------------------------------------------------------
        success: "border-data-ok/30 bg-data-ok-surface text-data-ok-text",
        warning: "border-data-caution/30 bg-data-caution-surface text-data-caution-text",
        outline: "border-border text-foreground font-bold [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        // The tinted outlines share `outline`'s muted hover. `light-muted` /
        // `active` were never tokens (see globals.css), so they resolved to no
        // class at all and the hover simply did nothing.
        outline_secondary:
          "border-secondary text-secondary font-bold [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        outline_active:
          "border-data-ok/50 text-data-ok-text font-bold [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        outline_destructive:
          "border-destructive text-destructive font-bold [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
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
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
