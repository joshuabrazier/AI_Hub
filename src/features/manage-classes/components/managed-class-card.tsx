import { CalendarRange, LayoutPanelLeft, MapPin, UserRound, Users } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DAY_OF_WEEK_LABELS, type ClassScheduleDay } from "@/lib/data/kysely-database-types";
import { formatDateRange, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ManagedClassDTO } from "../manage-classes.types";

// One day of the weekly pattern, e.g. "Mon 4:00 PM to 4:30 PM".
function formatScheduleDay(slot: ClassScheduleDay): string {
  return `${DAY_OF_WEEK_LABELS[slot.day].slice(0, 3)} ${formatTimeRange(slot.startTime, slot.endTime)}`;
}

// -------------------------------------------------------------------
// One class in the manager's list.
//
// Read-only: everything here was already resolved for the caller's scope, and
// there is nothing to click through to. Classes are edited in the admin area.
// -------------------------------------------------------------------
export function ManagedClassCard({ managedClass }: { managedClass: ManagedClassDTO }) {
  const full = managedClass.memberCount >= managedClass.capacity;

  return (
    <Card className="shadow-sm">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {managedClass.programName}
            </p>
            <h2 className="mt-1 truncate font-heading text-lg font-semibold leading-snug text-foreground">
              {managedClass.name}
            </h2>
            {managedClass.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{managedClass.description}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge active={managedClass.isActive} />
            {managedClass.isRunning && (
              <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-primary">
                Running now
              </span>
            )}
          </div>
        </div>

        {/* The weekly pattern, one chip per day the class runs. */}
        {managedClass.schedule.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {managedClass.schedule.map((slot) => (
              <li
                key={`${slot.day}-${slot.startTime}`}
                className="rounded bg-muted px-2 py-1 font-mono text-xs font-medium text-muted-foreground"
              >
                {formatScheduleDay(slot)}
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <MapPin size={16} aria-hidden="true" className="shrink-0 text-signal" />
            <dt className="sr-only">Location</dt>
            <dd className="truncate text-muted-foreground">{managedClass.locationName}</dd>
          </div>
          <div className="flex items-center gap-2">
            <UserRound size={16} aria-hidden="true" className="shrink-0 text-signal" />
            <dt className="sr-only">Lead</dt>
            <dd className="truncate text-muted-foreground">{managedClass.leadUserName ?? "No lead"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <CalendarRange size={16} aria-hidden="true" className="shrink-0 text-signal" />
            <dt className="sr-only">Dates</dt>
            {/* Both are 'YYYY-MM-DD' calendar days, formatted as strings. */}
            <dd className="font-mono text-xs text-muted-foreground">
              {formatDateRange(managedClass.startDate, managedClass.endDate)}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Users size={16} aria-hidden="true" className="shrink-0 text-signal" />
            <dt className="text-muted-foreground">People</dt>
            <dd
              className={cn(
                "font-mono font-medium tabular-nums",
                full ? "text-destructive" : "text-foreground",
              )}
            >
              {managedClass.memberCount} / {managedClass.capacity}
            </dd>
          </div>
        </dl>

        {/* The owning team. Only an ADMIN can reach the null branch: a class
            with no team is admin-only, so it never appears in a manager's
            scoped list. */}
        <Badge variant={managedClass.teamName ? "secondary" : "outline"} className="mt-auto w-fit">
          <LayoutPanelLeft size={12} aria-hidden="true" />
          {managedClass.teamName ?? "No team, admin only"}
        </Badge>
      </CardContent>
    </Card>
  );
}
