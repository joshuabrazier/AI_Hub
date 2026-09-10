"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { HEADER_NAV_LINKS } from "./landing-nav";

// -------------------------------------------------------------------
// LandingMobileMenu
// Burger + slide-out sheet for the public header on small screens.
// -------------------------------------------------------------------
export function LandingMobileMenu() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        {/* text-FOREGROUND, not primary-foreground. The header is
            bg-background, so a primary-foreground icon was white on white
            in light mode - the burger was invisible on every phone, which
            is the only place it renders. */}
        <Button variant="ghost" size="icon" className="text-foreground md:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle className="text-left">Menu</SheetTitle>
        </SheetHeader>

        <nav aria-label="Mobile" className="mt-6 flex flex-col gap-1 px-2">
          {HEADER_NAV_LINKS.map((link) => (
            <SheetClose asChild key={link.label}>
              <Link
                href={link.href}
                className="rounded-md px-3 py-2 text-base font-semibold text-foreground transition-colors hover:bg-muted hover:text-primary"
              >
                {link.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
