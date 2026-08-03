import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// IconBadge
// Circular icon holder used across the public site (feature strips,
// value lists, contact details). Renders a Lucide icon in the brand
// colour inside a circle.
//
//  - variant "border": transparent with a subtle outline (default)
//  - variant "soft":   filled with a soft tint of the primary colour
// -------------------------------------------------------------------
type IconBadgeSize = "sm" | "md" | "lg";
type IconBadgeVariant = "border" | "soft";

const SIZES: Record<IconBadgeSize, { badge: string; icon: number }> = {
  sm: { badge: "size-12", icon: 24 },
  md: { badge: "size-14", icon: 26 },
  lg: { badge: "size-18", icon: 32 },
};

const VARIANTS: Record<IconBadgeVariant, string> = {
  border: "border border-border",
  soft: "bg-primary/10",
};

export default function IconBadge({
  icon: Icon,
  size = "sm",
  variant = "border",
  className,
}: {
  icon: LucideIcon;
  size?: IconBadgeSize;
  variant?: IconBadgeVariant;
  className?: string;
}) {
  const sizes = SIZES[size];

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-primary",
        sizes.badge,
        VARIANTS[variant],
        className,
      )}
    >
      <Icon size={sizes.icon} aria-hidden="true" />
    </span>
  );
}
