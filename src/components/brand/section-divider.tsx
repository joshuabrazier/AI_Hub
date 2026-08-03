import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// SectionDivider
// A hairline between sections. One component so the spacing and weight of
// section breaks stay consistent, and so changing them is a single edit.
//
// Decorative, so it is hidden from assistive technology - the heading that
// follows is what actually announces a new section.
// -------------------------------------------------------------------
export default function SectionDivider({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("border-t border-border", className)} />;
}
