import Link from "next/link";

import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// BrandLink
// The wrapper used for the logo link in the site header and the app navbar.
//
// It exists for one reason: to keep a visible keyboard focus ring on the
// logo. The ring used to live inside the (now removed) splash animation
// component, so extracting it here stops it disappearing with the animation.
// Do not replace this with a bare <Link> - the logo would lose its focus
// indicator and fail WCAG 2.4.7.
// -------------------------------------------------------------------
export function BrandLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "relative inline-flex rounded-lg outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      {...props}
    />
  );
}
