"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import {
  ALL_CATEGORIES,
  CategoryOptionDTO,
  MonthOptionDTO,
  PersonOptionDTO,
  ProjectOptionDTO,
  TimesheetFiltersDTO,
} from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Filter bar
//
// Every filter lives in the URL rather than in component state, so a narrowed
// view can be linked to and sent to someone. "The number I am looking at" is
// exactly what gets pasted into an email when a client queries one line of an
// invoice, and a dashboard that always reopens on the unfiltered current month
// makes that impossible.
//
// Navigation runs inside a transition, so the controls stay live and the old
// numbers stay on screen while the server re-renders instead of the page
// blanking to a spinner.
// -------------------------------------------------------------------

// One duration and one easing for the whole screen, so nothing feels like it
// belongs to a different app. 200ms sits in the 150-300ms band that reads as
// feedback rather than as animation.
const TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const;

// Changing a filter keeps you on the view you are looking at, rather than
// bouncing back to the Timesheet tab. The pathname comes from the router so
// this works unchanged on all four views.
function buildHref(pathname: string, filters: TimesheetFiltersDTO, change: Partial<TimesheetFiltersDTO>): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams({ month: next.month });

  // Defaults are left out of the URL entirely, so a plain link stays short and
  // readable rather than carrying "&category=all&project=all&person=all".
  if (next.category !== ALL_CATEGORIES) params.set("category", next.category);
  if (next.project !== ALL_CATEGORIES) params.set("project", next.project);
  if (next.person !== ALL_CATEGORIES) params.set("person", next.person);

  return `${pathname || ROUTES.ADMIN_TIMESHEETS}?${params.toString()}`;
}

// -------------------------------------------------------------------
// Internal vs External, as a segmented control.
//
// A segmented control rather than a dropdown because there are only a handful
// of categories and the split between them IS the headline: how much of the
// month was client work. Hiding that behind a closed menu buries the answer.
//
// The active pill is a shared layout element, so it slides between options
// instead of blinking. That is the one place motion earns its place here - it
// shows which option you came from.
// -------------------------------------------------------------------
export function CategorySegmentedControl({
  filters,
  options,
}: {
  filters: TimesheetFiltersDTO;
  options: CategoryOptionDTO[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();

  if (options.length <= 2) return null;

  return (
    <LayoutGroup id="timesheet-category">
      <div
        role="group"
        aria-label="Job category"
        className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1"
      >
        {options.map((option) => {
          const isActive = option.value === filters.category;

          return (
            <button
              key={option.value}
              type="button"
              disabled={isPending}
              aria-pressed={isActive}
              onClick={() => {
                if (isActive) return;
                startTransition(() => router.push(buildHref(pathname, filters, { category: option.value })));
              }}
              className={cn(
                "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                // A real focus ring, never removed: this is the primary way
                // the screen is navigated by keyboard.
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                isPending && "cursor-wait",
              )}
            >
              {isActive && (
                <motion.span
                  // layoutId makes this one element that moves between
                  // buttons, rather than one fading out and another in.
                  layoutId="category-pill"
                  className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border"
                  transition={reduceMotion ? { duration: 0 } : TRANSITION}
                />
              )}

              <span className="relative flex items-baseline gap-2">
                {option.label}
                {/* Tabular figures so the number does not jitter the label
                    width as it changes between periods. */}
                <span className="text-xs tabular-nums text-muted-foreground">{option.hours.toFixed(2)}h</span>
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

// -------------------------------------------------------------------
// Period and project, as dropdowns. Both are lists that grow without bound,
// which is what a select is for.
// -------------------------------------------------------------------
export function PeriodSelect({ filters, options }: { filters: TimesheetFiltersDTO; options: MonthOptionDTO[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={filters.month}
      disabled={isPending}
      onValueChange={(month) => startTransition(() => router.push(buildHref(pathname, filters, { month })))}
    >
      <SelectTrigger className="w-[190px]" aria-label="Reporting period">
        <SelectValue placeholder="Choose a month" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProjectSelect({ filters, options }: { filters: TimesheetFiltersDTO; options: ProjectOptionDTO[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Nothing to choose between when there is a single job.
  if (options.length <= 2) return null;

  return (
    <Select
      value={filters.project}
      disabled={isPending}
      onValueChange={(project) => startTransition(() => router.push(buildHref(pathname, filters, { project })))}
    >
      <SelectTrigger className="w-[260px]" aria-label="Job">
        <SelectValue placeholder="All jobs" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex w-full items-center justify-between gap-3">
              <span className="truncate">
                {option.value === ALL_CATEGORIES ? option.label : (option.summary ?? option.label)}
              </span>
              {option.value !== ALL_CATEGORIES && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{option.hours.toFixed(2)}h</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// -------------------------------------------------------------------
// The staff selector.
//
// The value is the Atlassian accountId, never the display name: two people can
// share a name and one person can change theirs, and either would silently
// merge or split somebody's hours.
// -------------------------------------------------------------------
export function PersonSelect({ filters, options }: { filters: TimesheetFiltersDTO; options: PersonOptionDTO[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  if (options.length <= 2) return null;

  return (
    <Select
      value={filters.person}
      disabled={isPending}
      onValueChange={(person) => startTransition(() => router.push(buildHref(pathname, filters, { person })))}
    >
      <SelectTrigger className="w-[220px]" aria-label="Staff member">
        <SelectValue placeholder="Everyone" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex w-full items-center justify-between gap-3">
              <span className="truncate">{option.label}</span>
              {option.value !== ALL_CATEGORIES && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{option.hours.toFixed(2)}h</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
