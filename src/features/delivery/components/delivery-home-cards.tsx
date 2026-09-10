import Link from "next/link";
import { AlertTriangle, CalendarClock, CircleDot, FolderKanban, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { formatIsoDate } from "@/lib/format";
import { TASK_COLUMNS, TASK_COLUMN_LABELS, type TaskColumn } from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

import {
  formatMinutesAsClock,
  visibleWork,
  type MyDeliverySummaryDTO,
  type MyWorkItemDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// THE DELIVERY CARDS ON A LANDING PAGE
// ===================================================================
//
// SERVER COMPONENTS, with no state and no handlers - they render a DTO the
// page already awaited. Nothing here fetches, so putting them on a second
// dashboard costs that page one call to getMyDeliverySummaryService and not
// a second round of queries.
//
// THEY FORMAT AND NEVER COMPUTE. Every minute figure was summed server-side
// and is rendered through formatMinutesAsClock, which is the one place that
// decides how a duration reads. A card dividing by sixty is how a tile comes
// to disagree with the timesheet it links to by a rounding step.
//
// EVERY ROUTE IS PASSED IN. These render in the admin area and the portal,
// and the proxy REDIRECTS a role that lands in the wrong area rather than
// refusing it - so a hardcoded /portal/... followed by an admin would be a
// link that quietly goes somewhere else rather than an error anybody sees.
//
// EVERY PIECE OF TEXT IN A ROW WAS TYPED BY SOMEBODY - a client name, a
// project title, a task title - so all of it renders as a text node, and all
// of it truncates rather than wrapping a card out of shape.
// -------------------------------------------------------------------

/** Where each card's "see everything" link goes, by area. */
export type DeliveryHomeRoutes = {
  projects: string;
  timesheet: string;
  /** A board, by project id. Built by the caller from projectBoardForRole. */
  board: (projectId: string) => string;
};

const COLUMN_TONE: Record<TaskColumn, "default" | "secondary" | "destructive" | "warning"> = {
  [TASK_COLUMNS.BLOCKED]: "destructive",
  [TASK_COLUMNS.IN_PROGRESS]: "default",
  [TASK_COLUMNS.TODO]: "secondary",
  [TASK_COLUMNS.DONE]: "secondary",
};

// -------------------------------------------------------------------
// Three headline figures, each linking to the page that owns it.
// -------------------------------------------------------------------
export function DeliveryStatTiles({
  summary,
  routes,
}: {
  summary: MyDeliverySummaryDTO;
  routes: DeliveryHomeRoutes;
}) {
  const tiles = [
    {
      icon: CalendarClock,
      value: formatMinutesAsClock(summary.week.totalMinutes),
      label: "Logged this week",
      href: routes.timesheet,
    },
    {
      icon: ListTodo,
      value: String(summary.work.length),
      label: summary.work.length === 1 ? "Task waiting on you" : "Tasks waiting on you",
      href: routes.projects,
    },
    {
      icon: FolderKanban,
      value: String(summary.projectCount),
      label: summary.projectCount === 1 ? "Project you are on" : "Projects you are on",
      href: routes.projects,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {tiles.map((tile) => {
        const Icon = tile.icon;

        return (
          <Link
            key={tile.label}
            href={tile.href}
            className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon size={16} aria-hidden="true" />
            </span>
            <p className="mt-3 font-heading text-2xl font-bold tabular-nums text-foreground">{tile.value}</p>
            <p className="text-sm text-muted-foreground">{tile.label}</p>
          </Link>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------
// WHAT IS WAITING ON THIS PERSON.
//
// Ordered by attention rather than by board position - blocked first - which
// is decided in delivery.types.ts and sorted in the service. See byAttention
// for why.
// -------------------------------------------------------------------
export function WaitingOnYouCard({
  summary,
  routes,
}: {
  summary: MyDeliverySummaryDTO;
  routes: DeliveryHomeRoutes;
}) {
  // Capped at WORK_CARD_ROWS, and `remaining` is what keeps the truncation
  // visible. See visibleWork - the decision and its reasoning live next to
  // the DTO so they can be tested.
  const { shown, remaining } = visibleWork(summary.work);

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <ListTodo size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-semibold leading-snug text-foreground">
              Waiting on you
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {summary.counts.blocked > 0
                ? `${summary.counts.blocked} blocked, ${summary.counts.inProgress} in progress, ${summary.counts.todo} to do`
                : `${summary.counts.inProgress} in progress, ${summary.counts.todo} to do`}
            </p>
          </div>
        </div>

        {summary.work.length > 0 && (
          <CardAction>
            <Link
              href={routes.projects}
              className="rounded text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              All work
            </Link>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        {shown.length === 0 ? (
          // NOT AN ERROR AND NOT A BLANK. Nothing assigned is the ordinary
          // state for somebody new, and for anybody who has just finished.
          <p className="py-2 text-sm text-muted-foreground">
            Nothing is assigned to you right now. Tasks you are put on show up here, with the blocked ones
            first.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((item) => (
              <WorkRow key={item.taskId} item={item} href={routes.board(item.projectId)} />
            ))}
          </ul>
        )}

        {remaining > 0 && (
          <p className="pt-3 text-sm text-muted-foreground">
            <Link
              href={routes.projects}
              className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {remaining} more {remaining === 1 ? "task" : "tasks"}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WorkRow({ item, href }: { item: MyWorkItemDTO; href: string }) {
  // OVER ITS ESTIMATE is worth saying on the row, because it is the thing
  // somebody would want to know before opening it - and it is a comparison
  // of two figures that were both summed server-side, not arithmetic on
  // them. An unestimated task (0) is not "over": it was never given a
  // number to be over.
  const isOver = item.estimateMinutes > 0 && item.loggedMinutes > item.estimateMinutes;

  return (
    <li>
      <Link
        href={href}
        className="flex items-start gap-3 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="mt-0.5 shrink-0">
          {item.boardColumn === TASK_COLUMNS.BLOCKED ? (
            <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />
          ) : (
            <CircleDot size={16} className="text-muted-foreground" aria-hidden="true" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.clientName} - {item.projectTitle} - {item.phaseName}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={COLUMN_TONE[item.boardColumn]}>{TASK_COLUMN_LABELS[item.boardColumn]}</Badge>
          <span className={cn("text-xs tabular-nums", isOver ? "text-destructive" : "text-muted-foreground")}>
            {formatMinutesAsClock(item.loggedMinutes)}
            {item.estimateMinutes > 0 ? ` of ${formatMinutesAsClock(item.estimateMinutes)}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

// -------------------------------------------------------------------
// THE WEEK SO FAR, as seven bars.
//
// The point is the SHAPE rather than the numbers - a day nobody logged
// against is visible at a glance, which is the thing a timesheet is
// habitually wrong about and the reason somebody opens it on a Friday.
//
// The bars are proportional to the busiest day rather than to a target,
// because this app has no notion of a contracted day for a member: inventing
// one to draw against would be the same mistake as a model computing
// utilisation, which the timesheet rules forbid at length.
// -------------------------------------------------------------------
export function YourWeekCard({
  summary,
  today,
  routes,
}: {
  summary: MyDeliverySummaryDTO;
  /** 'YYYY-MM-DD' in the APP's timezone, from the page. Never new Date(). */
  today: string;
  routes: DeliveryHomeRoutes;
}) {
  const busiest = Math.max(...summary.week.dayTotalMinutes, 0);

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <CalendarClock size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-semibold leading-snug text-foreground">
              Your week
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {formatMinutesAsClock(summary.week.totalMinutes)} logged since{" "}
              {formatIsoDate(summary.week.weekStart, "d MMMM")}
            </p>
          </div>
        </div>

        <CardAction>
          <Link
            href={routes.timesheet}
            className="rounded text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Open timesheet
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ul className="flex items-end justify-between gap-2">
          {summary.week.dates.map((date, index) => {
            const minutes = summary.week.dayTotalMinutes[index] ?? 0;
            const isToday = date === today;
            // Proportional to the busiest day, with a floor so an empty day
            // is still a visible tick rather than nothing at all.
            const height = busiest > 0 ? Math.max(4, Math.round((minutes / busiest) * 64)) : 4;

            return (
              <li key={date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {minutes > 0 ? formatMinutesAsClock(minutes) : ""}
                </span>

                <span
                  className={cn(
                    "w-full rounded-t-sm",
                    minutes > 0 ? "bg-primary" : "bg-muted",
                    isToday && "ring-2 ring-primary/40",
                  )}
                  style={{ height: `${height}px` }}
                  aria-hidden="true"
                />

                <span
                  className={cn(
                    "text-xs",
                    isToday ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatIsoDate(date, "EEEEEE")}
                </span>

                {/* The bar is decorative; this is what a screen reader gets,
                    because a height in pixels says nothing out loud. */}
                <span className="sr-only">
                  {formatIsoDate(date, "EEEE d MMMM")}: {formatMinutesAsClock(minutes)} logged
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
