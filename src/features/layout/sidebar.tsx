"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { isCollapsible, type NavCollapsible, type NavLink as NavLinkEntry } from "./nav-items";
import { useNavGroups } from "./useNavGroups";
import { useSidebar } from "./sidebar-context";
import { NavigationPendingReporter } from "./navigation-pending";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// -------------------------------------------------------------------
// ===================================================================
// THE RAIL
// ===================================================================
//
// IT USED TO BE A SATURATED TEAL SLAB, and that was the single most
// templated thing about this app - a block of brand colour down the left of
// every screen is the look every admin panel has had since about 2014. It was
// also a direct contradiction of this palette's own note, which says the
// sidebar is "near-white, separated from the content by its border rather than
// by a fill, so the app chrome does not darken the page". That was written and
// never built: sidebar.tsx said `bg-primary dark:bg-sidebar`, so every
// --sidebar-* token was dead in light mode, and the rows styled themselves
// with hardcoded `text-white/85`, `bg-white/20`, `border-white/15`.
//
// That last part was a rebranding hazard as well as a look. This repo's rule
// is that rebranding is one file - the tokens - and a rail painted in
// `--primary` with white text on top of it breaks the moment somebody's brand
// colour is a light one. The nav would go invisible and nothing in the token
// file would explain why.
//
// So the rail is the near-white surface it was specified as, and the brand
// teal becomes rare rather than constant: it is on filled buttons, on figures
// that must be read, and on the ONE mark below.
//
// -------------------------------------------------------------------
// THE MARK. `--signal` is documented as the brighter teal for "the active nav
// item, the unread dot" and was used in exactly one place in the whole app -
// an icon picker. The system had a mark colour and marked nothing. The current
// page now gets a 3px signal bar flush to the rail's edge, in the margin, with
// a soft accent fill behind the row. That bar is the only saturated colour in
// the chrome, which is what makes it findable at a glance.
//
// -------------------------------------------------------------------
// IT IS SECTIONED NOW. `useNavGroups` has always returned groups with labels,
// and this file threw them away with a comment saying "the group labels exist
// so a later stage can section it". Admin sees six groups - Overview, People,
// Delivery, Projects, Time and billing, Settings - flattened into one
// fifteen-item list, which is a scan every single time rather than a look. The
// labels are set in the mono face, which the token file describes as the
// utility face for exactly this: "eyebrows, labels".
//
// Collapsed, there is no room for a label, so a group becomes a hairline rule.
// The grouping still reads; it just stops being named.
//
// -------------------------------------------------------------------
// THE ROWS HAVE HONEST GEOMETRY. A row was `h-10` containing a `size-10` icon
// box - a 40px square inside a 40px row - so the 20px glyph floated in the
// middle of the row's whole height with no left padding relationship to
// anything, and the label started 48px in. The box is now the size of the
// glyph, the row is `h-9`, and the icon sits at the row's own padding.
//
// This drives DISPLAY only. Every route is independently guarded by the proxy
// and by its area layout. Hiding a link is not access control.
// -------------------------------------------------------------------

/** The shared row shape, so a link, a group header and a child cannot drift. */
const ROW =
  "group relative flex items-center rounded-md text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const ROW_IDLE = "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const ROW_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-foreground";

/**
 * The "you are here" bar: 3px of signal in the rail's own margin.
 *
 * A pseudo-element rather than a real node so it cannot be tabbed to or read
 * out - the row already carries `aria-current`, which is what announces this.
 */
const MARK =
  "before:absolute before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-signal before:content-['']";

// -------------------------------------------------------------------
// A single top-level link row.
// -------------------------------------------------------------------
function NavLinkRow({
  entry,
  collapsed,
  active,
}: {
  entry: NavLinkEntry;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = entry.icon;

  const link = (
    <Link
      href={entry.href}
      aria-label={entry.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        ROW,
        "h-9",
        collapsed ? "mx-1.5 justify-center" : "mx-2 gap-2.5 px-2.5",
        active ? ROW_ACTIVE : ROW_IDLE,
        active && MARK,
        active && (collapsed ? "before:-left-1.5" : "before:-left-2"),
      )}
    >
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      {!collapsed && <span className="min-w-0 truncate">{entry.label}</span>}
      <NavigationPendingReporter />
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
    </Tooltip>
  );
}

// -------------------------------------------------------------------
// A collapsible group of links. An accordion in both states - collapsed, it
// expands inline in the rail as icon-only child rows with tooltips, rather
// than as a flyout that would need its own dismissal behaviour.
//
// THE CHEVRON POINTS RIGHT AND ROTATES DOWN, rather than being a down-chevron
// that flips to up. A right-pointing chevron is the disclosure convention -
// it says "there is more inside this" - where a down one reads as a select.
// -------------------------------------------------------------------
function NavCollapsibleRow({
  entry,
  collapsed,
  pathname,
}: {
  entry: NavCollapsible;
  collapsed: boolean;
  pathname: string;
}) {
  const Icon = entry.icon;
  const childActive = entry.children.some((child) => child.href === pathname);
  // Open by default when one of its children is the current page.
  const [open, setOpen] = useState(childActive);

  const groupButton = (
    <button
      type="button"
      onClick={() => setOpen((previous) => !previous)}
      aria-expanded={open}
      aria-label={entry.label}
      className={cn(
        ROW,
        "h-9",
        collapsed ? "mx-1.5 w-[calc(100%-0.75rem)] justify-center" : "mx-2 w-[calc(100%-1rem)] gap-2.5 px-2.5",
        // A group whose child is open is not itself the current page, so it
        // gets the weight without the mark - the mark is on the child.
        childActive ? "font-medium text-sidebar-accent-foreground" : ROW_IDLE,
      )}
    >
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      {!collapsed && (
        <>
          <span className="min-w-0 truncate">{entry.label}</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={cn("ml-auto shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-90")}
          />
        </>
      )}
    </button>
  );

  return (
    <div>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{groupButton}</TooltipTrigger>
          <TooltipContent side="right">{entry.label}</TooltipContent>
        </Tooltip>
      ) : (
        groupButton
      )}

      {open && (
        // A nested list, because that is what a nested nav is - and it is
        // what tells a screen reader these belong to the row above rather
        // than being four more siblings of it.
        <ul
          className={cn(
            "mt-0.5 space-y-0.5",
            // A hairline the children hang off, so an open group reads as one
            // block rather than as more top-level rows that happen to be
            // indented. Only when there is width for it to mean anything.
            !collapsed && "ml-[1.6rem] border-l border-sidebar-border pl-1",
          )}
        >
          {entry.children.map((child) => {
            const ChildIcon = child.icon;
            const active = pathname === child.href;

            const childLink = (
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                aria-label={child.label}
                className={cn(
                  ROW,
                  "h-8",
                  collapsed ? "mx-1.5 justify-center" : "gap-2.5 px-2.5",
                  active ? ROW_ACTIVE : ROW_IDLE,
                  // Collapsed, a child has no indentation to place it, so the
                  // mark is the only thing saying which row is current.
                  active && collapsed && cn(MARK, "before:-left-1.5"),
                )}
              >
                <ChildIcon size={collapsed ? 18 : 15} aria-hidden="true" className="shrink-0" />
                {!collapsed && <span className="min-w-0 truncate">{child.label}</span>}
                <NavigationPendingReporter />
              </Link>
            );

            if (!collapsed) return <li key={child.href}>{childLink}</li>;

            return (
              <li key={child.href}>
                <Tooltip>
                  <TooltipTrigger asChild>{childLink}</TooltipTrigger>
                  <TooltipContent side="right">{child.label}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

  const navGroups = useNavGroups();

  return (
    <aside
      // Named so the navbar's toggle can point `aria-controls` at it. The
      // toggle carries `aria-expanded`, and an expanded-state control that
      // does not say what it expands leaves a screen reader announcing a
      // state with no subject.
      id="app-sidebar"
      className={cn(
        "fixed top-nav left-0 z-40 hidden h-[calc(100dvh-var(--nav-h))] flex-col border-r border-sidebar-border bg-sidebar md:flex",
        "transition-[width] duration-300 ease-in-out motion-reduce:transition-none",
        collapsed ? "w-rail-collapsed" : "w-rail",
      )}
    >
      <nav
        aria-label="Main"
        // The scrollbar is hidden rather than styled: the rail is 56px wide
        // when collapsed and a scrollbar there is most of a row's width.
        className="flex-1 overflow-x-hidden overflow-y-auto pt-2 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {/* -----------------------------------------------------------
            THE GROUPING IS PROGRAMMATIC, NOT JUST VISUAL.

            `role="group"` with `aria-labelledby` means the section name
            reaches a screen reader in BOTH states. Collapsed there is no
            room to draw the label, and the first version of this simply
            dropped it and put a rule there instead - so the grouping that
            makes a fifteen-item nav readable existed only for people who
            could see the width to draw it in. The label is `sr-only` when
            collapsed rather than absent, and the rule that stands in for it
            is `aria-hidden` because it is now decoration rather than the
            only signal.

            A REAL LIST, TOO. These were bare divs, so the rail announced as
            a run of links with no count and no structure. `<ul>`/`<li>`
            inside a `<nav>` is what a navigation tree is.
            ----------------------------------------------------------- */}
        {navGroups.map((group, groupIndex) => {
          const labelId = `nav-group-${group.label.replace(/\s+/g, "-").toLowerCase()}`;

          return (
            <div key={group.label} role="group" aria-labelledby={labelId}>
              {collapsed && groupIndex > 0 && <hr aria-hidden="true" className="mx-3 my-2 border-sidebar-border" />}

              <p
                id={labelId}
                className={cn(
                  collapsed
                    ? "sr-only"
                    : cn(
                        "px-4 pb-1.5 font-mono text-[0.625rem] font-medium tracking-[0.18em] text-muted-foreground/75 uppercase",
                        groupIndex === 0 ? "pt-1" : "pt-5",
                      ),
                )}
              >
                {group.label}
              </p>

              <ul className="space-y-0.5">
                {group.items.map((entry) => (
                  <li key={isCollapsible(entry) ? entry.label : entry.href}>
                    {isCollapsible(entry) ? (
                      <NavCollapsibleRow entry={entry} collapsed={collapsed} pathname={pathname} />
                    ) : (
                      <NavLinkRow entry={entry} collapsed={collapsed} active={pathname === entry.href} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
