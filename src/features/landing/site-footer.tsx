import Link from "next/link";

import Logo from "@/components/brand/logo";
import Container from "@/components/container";
import { copyrightLine } from "@/lib/brand";

import { PUBLIC_NAV_LINKS } from "./landing-nav";

// -------------------------------------------------------------------
// SiteFooter
// Shared footer for the public site: the wordmark, the public links and the
// copyright.
//
// The footer's own top border is what separates it from the page, so there is
// no divider inside as well - two lines doing one job just reads as a mistake.
//
// Deliberately quiet. The previous footer was a full-bleed coloured band with
// layered waves, which competed for attention it did not need.
// -------------------------------------------------------------------
export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <Container className="py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <Logo size="sm" asLink={false} />

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {PUBLIC_NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className="mt-10 font-mono text-xs text-muted-foreground">{copyrightLine()}</p>
      </Container>
    </footer>
  );
}
