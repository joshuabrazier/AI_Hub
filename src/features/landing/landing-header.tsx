import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";
import Logo from "@/components/brand/logo";
import Container from "@/components/container";
import { HEADER_NAV_LINKS } from "./landing-nav";
import { LandingMobileMenu } from "./landing-mobile-menu";

// -------------------------------------------------------------------
// Landing Header
// Standalone marketing nav for the public landing page (no sidebar).
// Uses a fluid container so the bar extends edge-to-edge on large
// screens rather than stopping at a fixed width.
// -------------------------------------------------------------------
export default function LandingHeader() {
  return (
    <header className="relative z-50 h-20 w-full border-b border-border bg-background">
      <Container fluid className="flex h-full items-center justify-between gap-4">
        <Logo size="sm" className="shrink-0" />

        <div className="flex shrink-0 items-center gap-4 md:gap-12">
          {/* Desktop nav links */}
          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex lg:gap-10 xl:gap-14">
            {HEADER_NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-base font-semibold text-foreground transition-colors hover:text-primary"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Always visible, at every width. */}
          <Button asChild variant="primaryOutline" size="xl" className="h-10 shrink-0 px-5 md:ml-6">
            <Link href={ROUTES.PUBLIC_AUTH_SIGN_IN}>Login</Link>
          </Button>

          {/* Mobile burger */}
          <LandingMobileMenu />
        </div>
      </Container>
    </header>
  );
}
