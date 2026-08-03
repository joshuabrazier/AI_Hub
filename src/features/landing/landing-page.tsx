import Link from "next/link";

import SectionDivider from "@/components/brand/section-divider";
import Container from "@/components/container";
import { Button } from "@/components/ui/button";
import { landingIcon } from "@/features/site-content/landing-content.types";
import { getLandingContent } from "@/features/site-content/site-content.service";

import LandingHeader from "./landing-header";
import SiteFooter from "./site-footer";

// -------------------------------------------------------------------
// Public home page
//
// Every block of copy here comes from site_content and is editable from the
// admin area, so changing the headline or the feature cards does not need a
// deploy. This file is layout only.
//
// The route must stay dynamic (it sets force-dynamic) or an edit would not
// appear until the next build.
// -------------------------------------------------------------------
export default async function LandingPage() {
  const { hero, highlights, features, cta } = await getLandingContent();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingHeader />

      <main id="main-content">
        {/* Hero. Typographic rather than image-led on purpose: the product is a
            portal, and a stock photograph would say less than the sentence. */}
        <section className="pb-16 pt-20 md:pb-24 md:pt-28">
          <Container>
            <div className="max-w-3xl">
              {hero.eyebrow && (
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{hero.eyebrow}</p>
              )}
              <h1 className="mt-5 text-pretty font-heading text-4xl font-bold leading-[1.08] tracking-tight md:text-5xl lg:text-6xl">
                {hero.heading}
              </h1>
              {hero.subheading && (
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">{hero.subheading}</p>
              )}

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild size="xl">
                  <Link href={hero.primaryCta.href}>{hero.primaryCta.label}</Link>
                </Button>
                {hero.secondaryCta && (
                  <Button asChild variant="primaryOutline" size="xl">
                    <Link href={hero.secondaryCta.href}>{hero.secondaryCta.label}</Link>
                  </Button>
                )}
              </div>
            </div>

            <SectionDivider className="mt-16" />
          </Container>
        </section>

        {/* Highlights: short claims, each carrying a mark rather than a card. */}
        {highlights.length > 0 && (
          <section className="pb-20">
            <Container>
              <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {highlights.map((highlight) => {
                  const Icon = landingIcon(highlight.icon);
                  return (
                    <li key={highlight.title} className="flex flex-col gap-3">
                      <Icon className="size-5 text-signal" aria-hidden="true" />
                      <h2 className="font-heading text-base font-semibold leading-snug">{highlight.title}</h2>
                      {highlight.body && (
                        <p className="text-sm leading-relaxed text-muted-foreground">{highlight.body}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Container>
          </section>
        )}

        {/* Features, on a faint tinted band so the white cards read as objects. */}
        <section className="border-y border-border bg-muted/60 py-20">
          <Container>
            <div className="max-w-2xl">
              <h2 className="font-heading text-3xl font-bold tracking-tight">{features.heading}</h2>
              {features.intro && <p className="mt-4 text-muted-foreground">{features.intro}</p>}
            </div>

            <SectionDivider className="mt-10" />

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.items.map((item) => {
                const Icon = landingIcon(item.icon);
                return (
                  <article
                    key={item.title}
                    className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-6 transition-colors hover:border-primary/40"
                  >
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-heading text-lg font-semibold">{item.title}</h3>
                    {item.description && (
                      <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                    )}
                  </article>
                );
              })}
            </div>
          </Container>
        </section>

        {/* Closing call to action */}
        <section className="py-24">
          <Container>
            <div className="max-w-2xl">
              <h2 className="font-heading text-3xl font-bold tracking-tight">{cta.heading}</h2>
              {cta.body && <p className="mt-4 text-muted-foreground">{cta.body}</p>}
              <Button asChild size="xl" className="mt-8">
                <Link href={cta.cta.href}>{cta.cta.label}</Link>
              </Button>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
