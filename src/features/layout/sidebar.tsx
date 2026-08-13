"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Menu } from "lucide-react";

import { isCollapsible, type NavCollapsible, type NavLink as NavLinkEntry } from "./nav-items";
import { useNavGroups } from "./useNavGroups";
import { useSidebar } from "./sidebar-context";
import { NavigationPendingReporter } from "./navigation-pending";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
        "group flex h-10 items-center rounded-md px-3 transition-all duration-200",
        collapsed ? "mx-1 justify-center px-0" : "mx-2 justify-start",
        active ? "bg-white/20 text-white" : "text-white/85 hover:bg-white/15 hover:text-white",
      )}
    >
      <div className="relative flex size-10 shrink-0 items-center justify-center">
        <Icon size={20} aria-hidden="true" />
      </div>
      {!collapsed && <span className="ml-2 text-sm font-medium whitespace-nowrap">{entry.label}</span>}
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
// A collapsible dropdown group. Accordion in both states - when the sidebar
// is collapsed it expands inline in the rail as icon-only child rows (with
// tooltips), rather than a separate flyout.
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
        "flex h-10 items-center rounded-md transition-all duration-200",
        collapsed ? "mx-1 w-[calc(100%-0.5rem)] justify-center" : "mx-2 w-[calc(100%-1rem)] px-3",
        childActive || (collapsed && open)
          ? "bg-white/10 text-white"
          : "text-white/85 hover:bg-white/15 hover:text-white",
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center">
        <Icon size={20} aria-hidden="true" />
      </div>
      {!collapsed && (
        <>
          <span className="ml-2 text-sm font-medium whitespace-nowrap">{entry.label}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn("ml-auto shrink-0 transition-transform duration-200", open && "rotate-180")}
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
        <div className="mt-1 space-y-1">
          {entry.children.map((child) => {
            const ChildIcon = child.icon;
            const active = pathname === child.href;
            const childLink = (
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                aria-label={child.label}
                className={cn(
                  "flex h-9 items-center rounded-md transition-all duration-200",
                  collapsed ? "mx-1 w-[calc(100%-0.5rem)] justify-center" : "mx-2 gap-2 pr-3 pl-6",
                  active ? "bg-white/20 text-white" : "text-white/75 hover:bg-white/15 hover:text-white",
                )}
              >
                <div className={cn("flex shrink-0 items-center justify-center", collapsed ? "size-9" : "size-6")}>
                  <ChildIcon size={collapsed ? 18 : 16} aria-hidden="true" />
                </div>
                {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{child.label}</span>}
                <NavigationPendingReporter />
              </Link>
            );

            if (!collapsed) return <div key={child.href}>{childLink}</div>;

            return (
              <Tooltip key={child.href}>
                <TooltipTrigger asChild>{childLink}</TooltipTrigger>
                <TooltipContent side="right">{child.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// Sidebar
//
// Renders whichever area's nav the signed-in user's role resolves to. The
// groups are flattened because the rail shows one continuous list; the group
// labels exist so a later stage can section it without changing nav-items.
// -------------------------------------------------------------------
export default function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  const navGroups = useNavGroups();
  const entries = navGroups.flatMap((group) => group.items);

  return (
    <aside
      className={`
        fixed top-20 left-0 z-50
        h-[calc(100vh-5rem)]
        hidden md:flex flex-col bg-primary dark:bg-sidebar text-white border-r border-white/15
        transition-all duration-300 ease-in-out motion-reduce:transition-none
        pointer-events-auto
        ${collapsed ? "w-16" : "w-64"}
      `}
    >
      {/* Header */}
      <div
        className={`
          flex items-center h-14 shrink-0 px-3 w-full relative z-50
          ${collapsed ? "justify-center" : "justify-end"}
        `}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className="
                relative z-50
                flex items-center justify-center h-10 w-10
                rounded-md transition-all duration-200 cursor-pointer
                text-white hover:bg-white/15
                active:scale-95
              "
            >
              <Menu size={20} />
            </button>
          </TooltipTrigger>

          <TooltipContent side="right">{collapsed ? "Expand Menu" : "Collapse Menu"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Links */}
      <nav
        aria-label="Main"
        className="relative z-40 flex-1 space-y-1 overflow-x-hidden overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry) =>
          isCollapsible(entry) ? (
            <NavCollapsibleRow key={entry.label} entry={entry} collapsed={collapsed} pathname={pathname} />
          ) : (
            <NavLinkRow key={entry.href} entry={entry} collapsed={collapsed} active={pathname === entry.href} />
          ),
        )}
      </nav>
    </aside>
  );
}
