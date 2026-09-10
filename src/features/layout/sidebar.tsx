"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { isCollapsible, type NavCollapsible, type NavGroup, type NavLink as NavLinkEntry } from "./nav-items";
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
// THE RAIL IS QUIET, AND IT TOOK THREE GOES TO ACCEPT THAT.
//
// It was `bg-primary dark:bg-sidebar` hardcoded here, with rows in
// `text-white/85`, `bg-white/20` and `border-white/15`. Two things were wrong
// and only one of them was the colour: every --sidebar-* token was dead in
// light mode, and a rail painted in `--primary` with literal white on it goes
// unreadable the moment somebody's brand colour is a light one. This repo's
// rule is that rebranding is one file.
//
// Replacing it with the near-white surface the tokens describe left the app
// with no large area of colour anywhere, because the same pass had also taken
// the tint off the tables and the fill off the dashboard chips. Reading that
// as "the rail needs colour back" produced a deep teal slab that was worse
// than either - the frame shouting over the thing it frames, and a second
// teal column beside it on the chat screen.
//
// THE COLOUR BELONGS IN THE CONTENT. The stat chips, the header metric, the
// table bands and the active row below carry it; the rail's whole job is to
// stay out of the way of the screen it borders. So it is near-white,
// separated by its border rather than by a fill, which is what the note on
// --sidebar said from the start.
//
// What survives from the detour is the token SHAPE: this component knows
// `--sidebar`, `--sidebar-foreground`, `--sidebar-muted-foreground`,
// `--sidebar-accent` and `--sidebar-mark` by name and not one value. That was
// the real fix, and it is independent of which way the colours go.
//
// -------------------------------------------------------------------
// THE MARK is `--sidebar-mark`, which resolves to `--signal`. The palette
// documents signal as the brighter teal for exactly this - "the active nav
// item" - and it had one use in the whole app, an icon picker. It is indirect
// rather than used directly because the rail is the thing that has to be able
// to change its mark when its surface changes: on the teal rail signal
// vanished into the background, and the indirection is what let that be a
// one-line answer.
//
// -------------------------------------------------------------------
// IT IS SECTIONED NOW. `useNavGroups` has always returned groups with labels,
// and this file threw them away with a comment saying "the group labels exist
// so a later stage can section it". Admin sees six groups - Overview, People,
// Delivery, Projects, Time and billing, Settings - flattened into one
// fifteen-item list, which is a scan every single time rather than a look.
//
// The sections render through NavGroupBlock below, which also holds the note
// on their type treatment and on why the grouping is programmatic rather
// than only drawn.
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
  "group relative flex items-center rounded-md text-sm transition-colors focus-visible:ring-3 focus-visible:ring-sidebar-ring/60 focus-visible:outline-none";

// ON THE RAIL'S OWN TOKENS, NOT THE PAGE'S. The values happen to match
// --muted-foreground and --accent in the light theme, and that is the point
// of keeping them separate anyway: the rail sits on #fcfdfd rather than
// #ffffff, so a tint tuned against white is a step too weak here, and
// whoever changes the rail's surface next needs one place to change its ink
// with it. That was the actual defect in the original `text-white/85` rail -
// not the colour, but that the ink was stated in the component.
const ROW_IDLE =
  "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

// THE CURRENT PAGE IS THE ONE COLOURED THING IN THE RAIL. `text-primary`
// rather than the accent foreground, because on a quiet near-white rail the
// fill alone is a very small difference to spot, and this is the row people
// look for first. Paired with the bar in the margin below.
const ROW_ACTIVE = "bg-sidebar-accent font-semibold text-primary";

/**
 * The "you are here" bar: 3px in the rail's own margin.
 *
 * A pseudo-element rather than a real node so it cannot be tabbed to or read
 * out - the row already carries `aria-current`, which is what announces this.
 */
const MARK =
  "before:absolute before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-mark before:content-['']";

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
      {/* min-w-0 AND flex-1 are both load-bearing: a flex child defaults to
          min-width:auto and will not go narrower than its own text, so
          `truncate` alone does nothing and a long project name runs under the
          rail's edge. flex-1 is what makes the rail's edge the boundary. */}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
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
  // Open by default when one of its children is the current page, unless the
  // group says otherwise - see NavCollapsible.defaultOpen. State lives here
  // rather than in a store, so it survives navigation (the sidebar is mounted
  // once, in the root layout) and resets on a reload.
  const [open, setOpen] = useState(entry.defaultOpen ?? childActive);

  // -----------------------------------------------------------------
  // RE-OPEN WHEN NAVIGATION LANDS INSIDE A SHUT GROUP.
  //
  // useState above is a SEED, read once. The sidebar is mounted by the root
  // layout and never unmounts, so without this a group shut on one page stays
  // shut after navigating into it - and the current page's row is then
  // invisible, with the highlight that says "you are here" hidden behind a
  // triangle. Somebody clicking Summaries from Home would watch nothing at
  // all happen in the nav.
  //
  // ADJUSTED DURING RENDER RATHER THAN IN AN EFFECT. React documents this
  // shape for "a prop changed and some state should follow it", and the
  // react-hooks/set-state-in-effect rule exists to push you to it: an effect
  // would paint the shut group first and then open it, which is a visible
  // flicker on every navigation into a group.
  //
  // ONE DIRECTION ONLY. It opens on arrival and never closes on departure, so
  // a group somebody deliberately shut stays shut until they go into it -
  // rather than a nav that reaches out and collapses a section while they are
  // reading it. Shutting a group you are CURRENTLY inside still works, since
  // this only fires on the render where childActive CHANGES.
  // -----------------------------------------------------------------
  const [wasChildActive, setWasChildActive] = useState(childActive);

  if (childActive !== wasChildActive) {
    setWasChildActive(childActive);
    if (childActive) setOpen(true);
  }

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
        childActive ? "font-semibold text-sidebar-foreground" : ROW_IDLE,
      )}
    >
      <Icon size={18} aria-hidden="true" className="shrink-0" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={cn("ml-auto shrink-0 text-sidebar-muted-foreground transition-transform", open && "rotate-90")}
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
                // The full name on hover, and ONLY when the rail is expanded.
                // A collapsed rail already wraps this row in a Tooltip below,
                // and setting both puts two bubbles on screen with different
                // text in them. Expanded is exactly the case the native one is
                // for, because that is when the label is truncated.
                title={collapsed ? undefined : child.tooltip}
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
                {!collapsed && <span className="min-w-0 flex-1 truncate">{child.label}</span>}
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

// -------------------------------------------------------------------
// ONE SECTION OF THE RAIL.
//
// Extracted because there are now two places that render sections - the
// scrolling list and the pinned footer - and a footer that rendered its rows
// loose would lose its name and its rule, reading as two orphans under a
// line.
//
// THE GROUPING IS PROGRAMMATIC, NOT JUST VISUAL. `role="group"` with
// `aria-labelledby` means the section name reaches a screen reader in BOTH
// states. Collapsed there is no room to draw the label, and the first version
// of this simply dropped it for a rule - so the grouping that makes a
// fifteen-item nav readable existed only for people who could see the width
// it was drawn in. The label goes `sr-only` there instead, and the rule that
// stands in for it is `aria-hidden`, because it is now decoration rather than
// the only signal.
//
// A REAL LIST, TOO. These were bare divs, so the rail announced as a run of
// links with no count and no structure. `<ul>`/`<li>` inside a `<nav>` is
// what a navigation tree is.
// -------------------------------------------------------------------
function NavGroupBlock({
  group,
  collapsed,
  pathname,
  isFirst,
}: {
  group: NavGroup;
  collapsed: boolean;
  pathname: string;
  /** Suppresses the leading rule and the extra top padding. */
  isFirst: boolean;
}) {
  const labelId = `nav-group-${group.label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div role="group" aria-labelledby={labelId}>
      {collapsed && !isFirst && <hr aria-hidden="true" className="mx-3 my-2 border-sidebar-border" />}

      {/* SENTENCE CASE, IN THE BODY FACE. This was 10px Plex Mono, uppercase,
          letter-spaced to 0.18em, and tracked mono uppercase is the single
          most identifiable machine-generated label treatment there is. It
          also made the section names harder to read than the links under
          them, which is backwards for the thing telling you where you are.
          Weight and colour do the separating instead. */}
      <p
        id={labelId}
        className={cn(
          collapsed
            ? "sr-only"
            : cn("px-2.5 pb-1 text-xs font-semibold text-foreground/70", isFirst ? "pt-1" : "pt-5"),
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
}

export default function Sidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

  const navGroups = useNavGroups();

  // -----------------------------------------------------------------
  // TWO LISTS, NOT ONE. Everything scrolls except the groups marked
  // `footer`, which sit below the scroll and are always on screen.
  //
  // Ordering alone would not do it. A footer group is last in the array too,
  // so with a short nav the two are indistinguishable - but the rail holds a
  // row per project, and once the list is taller than the window an
  // order-only account row is below the fold, which is exactly the moment
  // somebody is looking for it.
  //
  // SPLIT AS GROUPS RATHER THAN FLATTENED TO ENTRIES, which is the one change
  // from the version this came from: the rail is sectioned now, so a footer
  // that dropped its group would lose its name and its rule and read as two
  // loose rows under a line.
  // -----------------------------------------------------------------
  const scrollGroups = navGroups.filter((group) => !group.footer);
  const footerGroups = navGroups.filter((group) => group.footer);

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
        {scrollGroups.map((group, groupIndex) => (
          <NavGroupBlock
            key={group.label}
            group={group}
            collapsed={collapsed}
            pathname={pathname}
            isFirst={groupIndex === 0}
          />
        ))}
      </nav>

      {/* Below the scroll, so it stays put however long the list above it
          gets. `shrink-0` is what stops flex compressing it when the nav is
          taller than the rail - without it the row would be squashed to
          nothing rather than the list scrolling. */}
      {footerGroups.length > 0 && (
        // `border-sidebar-border`, not `border-white/15`. That worked while
        // the rail was a dark slab and is invisible on a near-white one -
        // the same class of bug as the row ink, and the reason the rail's
        // edges are a token now.
        <div className="shrink-0 border-t border-sidebar-border py-2">
          {footerGroups.map((group) => (
            <NavGroupBlock key={group.label} group={group} collapsed={collapsed} pathname={pathname} isFirst />
          ))}
        </div>
      )}
    </aside>
  );
}
