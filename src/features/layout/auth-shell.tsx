import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import Logo from "@/components/brand/logo";
import SectionDivider from "@/components/brand/section-divider";
import { BRAND, copyrightLine } from "@/lib/brand";
import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// AuthShell
// Layout for every route under the (auth) group: the same header as the rest
// of the site, a two-panel body, and a quiet footer.
//
// The left panel carries the product name rather than marketing copy. Sign-in
// is a moment of reassurance, not persuasion - someone here already knows what
// this is and wants to get in. It is hidden below `lg` so the form stays front
// and centre on a phone.
// -------------------------------------------------------------------
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="h-20 shrink-0 border-b border-border bg-background">
        <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
          <Logo size="sm" />
          <Link
            href={ROUTES.PUBLIC_HOME}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
      </header>

      <main id="main-content" className="grid flex-1 grid-rows-1 lg:grid-cols-5">
        <div className="hidden flex-col justify-center border-r border-border bg-muted/50 px-10 lg:col-span-3 lg:flex xl:px-16">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Secure sign in</p>
          <p className="mt-5 max-w-lg font-heading text-4xl font-bold leading-[1.1] tracking-tight text-foreground xl:text-5xl">
            {BRAND.name}
          </p>
          <SectionDivider className="mt-8 max-w-sm" />
          <p className="mt-8 max-w-md text-muted-foreground">
            Your teams, your documents and your messages, in one place.
          </p>
        </div>

        <div className="flex items-center justify-center px-6 py-12 sm:px-10 lg:col-span-2">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border bg-muted/40 py-6">
        <p className="px-6 text-center font-mono text-xs text-muted-foreground">{copyrightLine()}</p>
      </footer>
    </div>
  );
}
