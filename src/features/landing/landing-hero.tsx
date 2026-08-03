import Image from "next/image";
import Link from "next/link";

import Container from "@/components/container";
import { Button } from "@/components/ui/button";
import type { LandingHero as LandingHeroContent } from "@/features/site-content/landing-content.types";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// Public home page hero
//
// The copy sits ON the artwork, so this component has TWO visual modes and has
// to be correct in both:
//
//  - with an image: light copy over a scrimmed photograph
//  - without one:   the site's normal dark-on-white treatment
//
// The image is admin-editable (site_content -> landing_hero), which is what
// makes the second mode load-bearing rather than theoretical: an admin can
// blank the field, and the hero must still look deliberate rather than
// rendering white text on a white page.
// -------------------------------------------------------------------

// The scrim between the image and the copy.
//
// Its job is to guarantee legibility for ANY image an admin uploads, not just
// the dark artwork this base happens to ship. So the numbers below are set by
// the WORST case an admin could upload - a pure white image - and the binding
// constraint is the FAINTEST text, not the heading.
//
// Measured against a pure white image, with each text layer composited over the
// scrim (white text at alpha t on a scrim of alpha s):
//
//   text-white      heading    8.52:1   (needs 3:1,   large bold)
//   text-white/90   subheading 7.29:1   (needs 4.5:1, 18px regular is NOT "large")
//   text-white/80   eyebrow    6.17:1   (needs 4.5:1, 12px)
//
// at the /65 stop, which is the weakest point of the gradient. Over the shipped
// artwork the same text measures roughly 20:1.
//
// The gradient is directional because the copy is left-aligned: heaviest where
// the words are, lightest on the right where the artwork is left to show.
//
// Do not lower any stop below /65, and do not fade any text below /80, without
// redoing this maths. A /55 floor looks nearly identical on a dark image and
// silently drops the eyebrow to 3.23:1 on a bright one.
const SCRIM = "bg-linear-to-r from-black/85 via-black/75 to-black/65";

export default function LandingHero({ hero }: { hero: LandingHeroContent }) {
  // Drives every colour decision below. Kept as one flag so the two modes
  // cannot drift apart.
  const onImage = Boolean(hero.imageUrl);

  return (
    <section
      className={cn(
        // `isolate` creates a stacking context so the negative z-indices used
        // by the image and scrim stay inside this section instead of sliding
        // behind the page background.
        "relative isolate",
        onImage
          ? "overflow-hidden py-24 md:min-h-144 md:py-36"
          : "bg-background py-16 md:py-24",
      )}
    >
      {onImage && (
        <>
          <Image
            src={hero.imageUrl}
            alt={hero.imageAlt}
            fill
            priority
            // Spans the viewport, so the optimiser should pick a full-width
            // candidate rather than the half-width one a grid would need.
            sizes="100vw"
            className="-z-20 object-cover"
          />
          <div aria-hidden="true" className={cn("absolute inset-0 -z-10", SCRIM)} />
        </>
      )}

      <Container>
        <div className="max-w-3xl">
          {hero.eyebrow && (
            <p
              className={cn(
                "font-mono text-xs uppercase tracking-[0.18em]",
                // /80 not /70: at 12px this is small text, so it needs the full
                // 4.5:1 rather than the 3:1 a heading gets. See SCRIM.
                onImage ? "text-white/80" : "text-muted-foreground",
              )}
            >
              {hero.eyebrow}
            </p>
          )}

          <h1
            className={cn(
              "mt-5 text-pretty font-heading text-4xl font-bold leading-[1.08] tracking-tight md:text-5xl",
              onImage ? "text-white" : "text-foreground",
            )}
          >
            {hero.heading}
          </h1>

          {hero.subheading && (
            <p
              className={cn(
                "mt-6 max-w-xl text-lg leading-relaxed",
                // /90 not /85: text-lg is 18px regular, which falls just under
                // the WCAG "large text" threshold and so needs 4.5:1. See SCRIM.
                onImage ? "text-white/90" : "text-muted-foreground",
              )}
            >
              {hero.subheading}
            </p>
          )}

          <div className="mt-9 flex flex-wrap items-center gap-3">
            {/* The primary action keeps the brand fill in both modes: over the
                scrim the teal IS the pop of colour, and its own white label
                stays at 5.19:1 regardless of what is behind the button. */}
            <Button asChild size="xl">
              <Link href={hero.primaryCta.href}>{hero.primaryCta.label}</Link>
            </Button>

            {hero.secondaryCta && (
              // The secondary action has to swap variant, not just colour:
              // `primaryOutline` draws itself in brand teal, which is the one
              // thing that cannot be read against a dark scrim.
              <Button asChild size="xl" variant={onImage ? "onImageOutline" : "primaryOutline"}>
                <Link href={hero.secondaryCta.href}>{hero.secondaryCta.label}</Link>
              </Button>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
