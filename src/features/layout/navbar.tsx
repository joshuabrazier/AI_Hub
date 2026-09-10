"use client";

import Link from "next/link";
import { PanelLeft } from "lucide-react";

import { MobileSidebar } from "./mobile-sidebar";
import { useSidebar } from "./sidebar-context";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROUTES, roleHome } from "@/lib/routes";
import { authClient } from "@/lib/auth/auth-client";
import { UserMenu } from "./user-menu";
import Logo from "@/components/brand/logo";
import { BrandLink } from "@/components/brand/brand-link";
import { BRAND } from "@/lib/brand";

// -------------------------------------------------------------------
// The bar across the top.
//
// IT WAS 80 PIXELS TALL AND CARRIED TWO THINGS, and the rail below it then
// spent another 56 on a header holding one hamburger - so 136 pixels of every
// screen went to chrome before any content started, and the page header
// underneath added about 150 more. On a laptop that is a third of the window
// gone before the first figure. This is `h-nav` (56) and the rail's header is
// gone, because the toggle that lived in it is here.
//
// THE TOGGLE BELONGS UP HERE ANYWAY. It controls the rail, and the rail's
// width is the thing it changes - so a control sitting INSIDE the panel it
// resizes has to move with it, which is why it was centred when collapsed and
// right-aligned when open. Fixed in the corner it stays put, and the corner is
// square because the collapsed rail is exactly this bar's height.
//
// The wordmark goes to the signed-in user's own area, not a fixed one. It used
// to point at the admin dashboard for everybody, which sent members and
// managers to a page their role is refused, and the proxy bounced them
// straight back.
// -------------------------------------------------------------------
export default function Navbar() {
  const { data: session, isPending } = authClient.useSession();
  const { collapsed, toggle } = useSidebar();

  const homeHref = session ? roleHome(session.user.role) : ROUTES.PUBLIC_HOME;

  return (
    <header className="fixed top-0 right-0 left-0 z-50 h-nav border-b border-border bg-background">
      <div className="flex h-full items-center gap-1 pr-4 pl-2 sm:pr-6 sm:pl-3">
        <MobileSidebar />

        {/* Desktop only: below md the rail is a sheet and MobileSidebar owns
            its own trigger. */}
        {session && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
                aria-expanded={!collapsed}
                aria-controls="app-sidebar"
                onClick={toggle}
                className="hidden size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:flex"
              >
                <PanelLeft size={18} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{collapsed ? "Expand the menu" : "Collapse the menu"}</TooltipContent>
          </Tooltip>
        )}

        <BrandLink
          href={homeHref}
          aria-label={`${BRAND.name} - go to home`}
          className="ml-1 min-w-0 rounded"
        >
          <Logo size="sm" asLink={false} />
        </BrandLink>

        <div className="ml-auto flex items-center">
          {!session && !isPending && (
            <Button variant="default" size="sm" asChild>
              <Link href={ROUTES.PUBLIC_AUTH_SIGN_IN}>Sign in</Link>
            </Button>
          )}
          {session && <UserMenu user={session.user} />}
        </div>
      </div>
    </header>
  );
}
