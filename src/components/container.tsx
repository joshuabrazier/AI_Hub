import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Container
// Horizontal layout wrapper for the public site.
//
//  - default: centered, capped at a comfortable reading width.
//  - fluid:   full width, edge-to-edge with a small consistent gutter,
//             so bars like the header sit close to the page corners
//             instead of stopping at a fixed max width.
// -------------------------------------------------------------------
export default function Container({
  fluid = false,
  className,
  children,
}: {
  fluid?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        fluid
          ? "w-full px-4 sm:px-6 lg:px-8"
          : "mx-auto max-w-7xl px-6 xl:max-w-[90rem] 2xl:max-w-[96rem]",
        className,
      )}
    >
      {children}
    </div>
  );
}
