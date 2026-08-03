import Image from "next/image";

import { BrandLink } from "@/components/brand/brand-link";
import { BRAND } from "@/lib/brand";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg";

const SIZES: Record<LogoSize, { badge: string; primary: string; secondary: string }> = {
  sm: { badge: "size-9", primary: "text-lg", secondary: "text-[0.625rem]" },
  md: { badge: "size-11", primary: "text-xl", secondary: "text-[0.6875rem]" },
  lg: { badge: "size-14", primary: "text-2xl", secondary: "text-xs" },
};

// -------------------------------------------------------------------
// Logo
// The mark paired with the product wordmark. The name comes from BRAND, so
// rebranding is an environment change rather than a code edit, and the two
// lines are set in the heading and mono faces to match the rest of the system.
//
// Renders as a link to the public home by default; pass asLink={false} for a
// static mark (in a footer, or inside another link).
//
// Replace public/logo.png with your own square mark. It is decorative here -
// the wordmark beside it carries the name, so the image has an empty alt.
// -------------------------------------------------------------------
export default function Logo({
  size = "md",
  asLink = true,
  className,
}: {
  size?: LogoSize;
  asLink?: boolean;
  className?: string;
}) {
  const sizes = SIZES[size];

  const content = (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/logo.png"
        alt=""
        width={56}
        height={56}
        priority
        className={cn("shrink-0 rounded-lg object-cover", sizes.badge)}
      />
      <span className="flex flex-col gap-0.5 text-left leading-none">
        <span className={cn("font-heading font-bold tracking-tight text-foreground", sizes.primary)}>{BRAND.name}</span>
        <span className={cn("font-mono uppercase tracking-[0.2em] text-muted-foreground", sizes.secondary)}>
          {BRAND.shortName}
        </span>
      </span>
    </span>
  );

  if (!asLink) return content;

  return (
    <BrandLink href={ROUTES.PUBLIC_HOME} aria-label={`${BRAND.name} home`}>
      {content}
    </BrandLink>
  );
}
