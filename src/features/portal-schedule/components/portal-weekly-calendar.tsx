"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, addWeeks, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ATTENDANCE_STATUS, SESSION_STATUS, SESSION_STATUS_LABELS } from "@/lib/data/kysely-database-types";
import { formatIsoDate, formatTime, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";

import { getPortalWeekAction } from "../portal-schedule.actions";
import type { PortalScheduleSessionDTO, PortalWeekResponseDTO } from "../portal-schedule.types";
import { PortalSessionDialog } from "./portal-session-dialog";
import { STATUS_ACCENT_CLASSES, STATUS_PILL_CLASSES } from "./portal-session-styles";

// Normalise a 'YYYY-MM-DD' to the Monday of its week, the same way the service
// does, so a week always has one key on both sides of the request.
function toMonday(dateIso: string): string {
  return format(startOfWeek(parseISO(dateIso), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

// -------------------------------------------------------------------
// The member's week, as seven day lanes.
//
// `todayIso` arrives from the server in the app's time zone rather than being
// read from the browser clock. A viewer in another zone, or one whose machine
// is simply wrong, then sees the same "today" as the schedule they are looking
// at - and the first client render matches the server's, so there is no
// hydration mismatch to work around.
// -------------------------------------------------------------------
export function PortalWeeklyCalendar({ initialWeek }: { initialWeek: PortalWeekResponseDTO }) {
  const [weekStartIso, setWeekStartIso] = useState(initialWeek.weekStartIso);
  const [todayIso, setTodayIso] = useState(initialWeek.todayIso);
  const [sessions, setSessions] = useState<PortalScheduleSessionDTO[]>(initialWeek.sessions);
  const [selected, setSelected] = useState<PortalScheduleSessionDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Weeks fetched so far, so paging back and forth does not refetch. Seeded
  // with the week the server rendered.
  const cacheRef = useRef<Map<string, PortalScheduleSessionDTO[]>>(
    new Map([[initialWeek.weekStartIso, initialWeek.sessions]]),
  );

  useEffect(() => {
    const cached = cacheRef.current.get(weekStartIso);

    if (cached) {
      setSessions(cached);
      // Also clear a spinner left behind by a fetch this navigation superseded.
      setIsLoading(false);
      return;
    }

    // Guards against a slow response for an abandoned week overwriting the one
    // now on screen.
    let isCurrent = true;
    setIsLoading(true);

    (async () => {
      const response = await getPortalWeekAction({ weekStartIso });
      if (!isCurrent) return;

      if (response.success) {
        cacheRef.current.set(response.data.weekStartIso, response.data.sessions);
        setSessions(response.data.sessions);
        setTodayIso(response.data.todayIso);
      } else {
        toast.error(response.formError ?? "We could not load your schedule. Please try again.");
        setSessions([]);
      }

      setIsLoading(false);
    })();

    return () => {
      isCurrent = false;
    };
  }, [weekStartIso]);

  const weekStart = parseISO(weekStartIso);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const goToWeek = (offset: number) =>
    setWeekStartIso((current) => format(addWeeks(parseISO(current), offset), "yyyy-MM-dd"));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p aria-live="polite" className="font-heading text-lg font-bold text-foreground">
            {format(weekStart, "d MMM")} - {format(days[6], "d MMM yyyy")}
          </p>
          {isLoading && <Loader2 size={16} className="animate-spin text-muted-foreground" aria-label="Loading" />}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Previous week" onClick={() => goToWeek(-1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStartIso(toMonday(todayIso))}>
            This week
          </Button>
          <Button variant="outline" size="sm" aria-label="Next week" onClick={() => goToWeek(1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => {
          const dayIso = format(day, "yyyy-MM-dd");
          const daySessions = sessions.filter((session) => session.sessionDate === dayIso);
          // Both are 'YYYY-MM-DD', so these are string comparisons.
          const isToday = dayIso === todayIso;
          const isPast = dayIso < todayIso;

          return (
            <li
              key={dayIso}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow",
                isLoading && "opacity-60",
                isToday ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border",
              )}
            >
              <span aria-hidden="true" className={cn("h-1.5 w-full", isToday ? "bg-primary" : "bg-muted")} />

              <h2 className="px-3 pb-2 pt-3 text-center">
                <span className="sr-only">
                  {format(day, "EEEE d MMMM yyyy")}
                  {isToday ? " (today)" : ""}
                </span>
                <span
                  aria-hidden="true"
                  className="block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  {format(day, "EEE")}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 inline-flex size-8 items-center justify-center rounded-full text-lg font-bold",
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </h2>

              {daySessions.length > 0 ? (
                <ul className="flex-1 space-y-2 px-2 pb-3">
                  {daySessions.map((session) => (
                    <li key={session.id}>
                      <SessionCard session={session} onOpen={() => setSelected(session)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-1 items-center justify-center px-3 pb-6 pt-2">
                  <p className="text-xs text-muted-foreground">No sessions</p>
                </div>
              )}

              {/* Past days recede so the eye lands on what is still ahead. */}
              {isPast && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-muted-foreground/15" />
              )}
            </li>
          );
        })}
      </ul>

      <PortalSessionDialog
        key={selected?.id ?? "none"}
        session={selected}
        todayIso={todayIso}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------------
// One session on a day lane: time, class, location and status. The fuller
// detail is behind the click, so the lane stays scannable.
// -------------------------------------------------------------------
function SessionCard({ session, onOpen }: { session: PortalScheduleSessionDTO; onOpen: () => void }) {
  const isCancelled = session.status === SESSION_STATUS.CANCELLED;
  const hasCancelledPlace = session.attendanceStatus === ATTENDANCE_STATUS.CANCELLED;

  const openLabel = `${session.className} at ${formatTime(session.sessionStart)} on ${formatIsoDate(
    session.sessionDate,
    "EEE d MMM",
  )}, ${SESSION_STATUS_LABELS[session.status]}. View details`;

  return (
    <button
      type="button"
      aria-label={openLabel}
      onClick={onOpen}
      className={cn(
        "relative w-full rounded-lg border border-l-4 bg-card p-2.5 text-left shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        STATUS_ACCENT_CLASSES[session.status],
        isCancelled && "bg-destructive/5",
      )}
    >
      <span className="flex items-center gap-1 text-sm font-bold text-primary">
        <Clock size={13} aria-hidden="true" className="shrink-0" />
        {formatTimeRange(session.sessionStart, session.sessionEnd)}
      </span>

      <span
        className={cn(
          "mt-1 block font-semibold leading-snug text-foreground",
          (isCancelled || hasCancelledPlace) && "line-through",
        )}
      >
        {session.className}
      </span>

      <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin size={12} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{session.locationName}</span>
      </span>

      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_PILL_CLASSES[session.status])}>
          {SESSION_STATUS_LABELS[session.status]}
        </span>
        {/* Distinct from a cancelled session: the class is still running, this
            member just is not in it. */}
        {hasCancelledPlace && !isCancelled && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Place cancelled
          </span>
        )}
      </span>

      {session.closureReason && (
        <span className="mt-1.5 block text-[11px] font-medium text-destructive">{session.closureReason}</span>
      )}
    </button>
  );
}
