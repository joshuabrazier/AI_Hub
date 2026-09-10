import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

// -------------------------------------------------------------------
// ===================================================================
// A HEADLINE COUNT
// ===================================================================
//
// THREE EXPORTS CAME OUT OF THIS FILE AND NOTHING IMPORTED THEM.
// `BrandChip` - a solid brand-teal rounded tile with a white icon in it -
// `DashboardCard` and a local `EmptyState` all had no callers anywhere in the
// app. The file's own note argued the chip existed "as a component rather
// than as a copied class string" so that "one component means one look", and
// it had ended up with no looks at all. They are gone; `StatTile` is what
// this file is for.
//
// -------------------------------------------------------------------
// IT MATCHES THE OTHER STATTILE ON PURPOSE, and the fact that there are two
// is worth stating rather than hiding. `admin-timesheets/timesheet-panels`
// exports one as well, used about twenty times across the timesheets views,
// and the two looked nothing alike: that one puts a tracked uppercase label
// above the figure, this one used to put a 48px teal chip beside a 4xl bold
// number with the label underneath - so the same job had two answers on
// adjacent screens, and the label was in the weakest position on the tile
// that a person scans a grid of.
//
// They are now the same shape, the same type and the same sizes. Extracting
// one shared component is the right end state and is a bigger move than a
// design pass: that one carries the timesheets' reveal, hover-lift,
// count-up and proportion-bar behaviour, none of which belongs in
// src/components. Whoever does it should start from this pair.
//
// THE LABEL COMES FIRST BECAUSE THAT IS HOW A GRID OF TILES IS READ: you
// find the label you want, then read the figure. A figure on its own is only
// the headline when there is exactly one of it, which is the page header's
// `metric` slot rather than this.
// -------------------------------------------------------------------
export function StatTile({
  icon: Icon,
  value,
  label,
  href,
}: {
  icon: LucideIcon;
  value: number | string;
  label: string;
  /**
   * A figure with a page behind it becomes a link to it, and one that does
   * not stays plain. The whole tile is the target rather than a "view"
   * affordance in a corner, so the hit area matches what looks clickable.
   */
  href?: string;
}) {
  const body = (
    <CardContent className="flex items-center gap-3.5 p-4">
      {/* -----------------------------------------------------------
          A TINTED CHIP, WHICH IS THE MIDDLE OF TWO EXTREMES.

          The dead `BrandChip` this replaces was a 48px SOLID brand fill with
          a white glyph - three of those in a row was the loudest thing on
          the page and the figures were competing with their own decoration.
          The version after it dropped the chip entirely for a 12px muted
          glyph inline with the label, and that went too far the other way:
          the dashboard ended up with no colour on it at all.

          A tint of the brand at 10% with the glyph in full brand carries the
          colour without shouting, and it is the same device the rest of the
          app uses for a quiet branded surface.
          ----------------------------------------------------------- */}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon size={19} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        {/* SENTENCE CASE, IN THE BODY FACE. This was 10px mono, uppercase,
            letter-spaced to 0.16em. The labels are already written as
            sentences ("Active members"), so the treatment was fighting the
            copy as well as reading as generated. */}
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span className="min-w-0 truncate">{label}</span>

          {/* THE TILE IS A LINK AND SHOULD LOOK LIKE ONE. Nothing said so
              before: the whole card was clickable with no affordance at all,
              which is a hit area people find by accident.

              VISIBLE AT REST, not revealed on hover - a touch screen has no
              hover, so a hover-only affordance is none at all on the devices
              least able to guess a card is a link. It brightens on hover
              instead, which is the state change doing its actual job. */}
          {href && (
            <ArrowUpRight
              size={13}
              aria-hidden="true"
              className="ml-auto shrink-0 text-primary/50 transition-colors group-hover/tile:text-primary"
            />
          )}
        </p>

        <p className="mt-1 font-heading text-3xl leading-none font-bold figure text-foreground">{value}</p>
      </div>
    </CardContent>
  );

  if (!href) return <Card>{body}</Card>;

  return (
    // The focus ring is drawn by the card, not the link inside it: the card
    // clips its children, so a ring on the link itself would be cut off.
    <Card className="group/tile transition-colors hover:border-primary/40 hover:bg-accent/40 focus-within:ring-3 focus-within:ring-ring/50">
      <Link href={href} className="outline-none">
        {body}
      </Link>
    </Card>
  );
}
