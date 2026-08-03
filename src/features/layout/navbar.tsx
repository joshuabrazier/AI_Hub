"use client";

import Link from "next/link";
import { MobileSidebar } from "./mobile-sidebar";
import { Button } from "@/components/ui/button";
import { ROUTES, roleHome } from "@/lib/routes";
import { authClient } from "@/lib/auth/auth-client";
import { UserMenu } from "./user-menu";
import Logo from "@/components/brand/logo";
import { BrandLink } from "@/components/brand/brand-link";
import { BRAND } from "@/lib/brand";

export default function Navbar() {
  const { data: session, isPending } = authClient.useSession();

  // The wordmark goes to the signed-in user's own area, not a fixed one. It
  // used to point at the admin dashboard for everybody, which sent members and
  // managers to a page their role is refused, and the proxy bounced them
  // straight back.
  const homeHref = session ? roleHome(session.user.role) : ROUTES.PUBLIC_HOME;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-20 border-b border-border bg-background">
      <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left */}
        <div className="flex items-center gap-3">
          <MobileSidebar />

          <BrandLink href={homeHref} aria-label={`${BRAND.name} - go to home`}>
            <Logo size="sm" asLink={false} />
          </BrandLink>
        </div>

        {/* Right */}
        {!session && !isPending && (
          <Button variant="default" className="font-normal" asChild>
            <Link href={ROUTES.PUBLIC_AUTH_SIGN_IN}>Sign In</Link>
          </Button>
        )}
        {session && <UserMenu user={session.user} />}
      </div>
    </header>
  );
}
