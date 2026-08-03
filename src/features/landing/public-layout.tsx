import SectionDivider from "@/components/brand/section-divider";
import Container from "@/components/container";

import LandingHeader from "./landing-header";
import SiteFooter from "./site-footer";

// -------------------------------------------------------------------
// PublicLayout
// Shared chrome for the secondary public pages (About, Contact, Privacy,
// Terms): the site header, a page title, and the site footer.
//
// The title sits on the page's own background rather than in a coloured band.
// These are reading pages, and a full-bleed banner above a wall of text only
// pushes the text further down.
// -------------------------------------------------------------------
export default function PublicLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <LandingHeader />

      <main id="main-content" className="flex-1">
        <Container className="py-16 md:py-20">
          <header className="max-w-3xl">
            <h1 className="font-heading text-4xl font-bold tracking-tight md:text-5xl">{title}</h1>
            {subtitle && <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>}
          </header>

          <SectionDivider className="mb-12 mt-10" />

          {children}
        </Container>
      </main>

      <SiteFooter />
    </div>
  );
}
