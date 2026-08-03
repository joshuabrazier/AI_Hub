"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Menu } from "lucide-react";

import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isCollapsible, type NavCollapsible, type NavLink as NavLinkEntry } from "./nav-items";
import { useNavGroups } from "./useNavGroups";
import { NavigationPendingReporter } from "./navigation-pending";

function MobileLink({
  entry,
  active,
  indented,
}: {
  entry: NavLinkEntry;
  active: boolean;
  indented?: boolean;
}) {
  const Icon = entry.icon;
  return (
    <SheetClose asChild>
      <Link
        href={entry.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
          indented && "pl-9",
          active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
        )}
      >
        <Icon size={indented ? 18 : 20} className="shrink-0" aria-hidden="true" />
        {entry.label}
        <NavigationPendingReporter />
      </Link>
    </SheetClose>
  );
}

function MobileCollapsible({ entry, pathname }: { entry: NavCollapsible; pathname: string }) {
  const Icon = entry.icon;
  const childActive = entry.children.some((child) => child.href === pathname);
  // Open by default when one of its children is the current page.
  const [open, setOpen] = useState(childActive);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
          childActive ? "text-primary" : "text-foreground hover:bg-muted",
        )}
      >
        <Icon size={20} className="shrink-0" aria-hidden="true" />
        {entry.label}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn("ml-auto shrink-0 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {entry.children.map((child) => (
            <MobileLink key={child.href} entry={child} active={pathname === child.href} indented />
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// The same nav as the rail, in a sheet. It renders whichever area's tree the
// signed-in user's role resolves to, exactly as the sidebar does, so the two
// can never disagree about what a role can see.
// -------------------------------------------------------------------
export function MobileSidebar() {
  const pathname = usePathname();
  const navGroups = useNavGroups();
  const entries = navGroups.flatMap((group) => group.items);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="w-72">
        {/* accessibility requirement */}
        <SheetHeader>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
        </SheetHeader>

        <nav className="mt-6 space-y-1 px-2">
          {entries.map((entry) =>
            isCollapsible(entry) ? (
              <MobileCollapsible key={entry.label} entry={entry} pathname={pathname} />
            ) : (
              <MobileLink key={entry.href} entry={entry} active={pathname === entry.href} />
            ),
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
