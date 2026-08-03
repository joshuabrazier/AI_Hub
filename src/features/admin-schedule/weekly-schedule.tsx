"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, MapPin, UserRound, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTime, formatTimeRange } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { SESSION_STATUS, SESSION_STATUS_LABELS, SessionStatus } from "@/lib/data/kysely-database-types";

import { SessionDetailDialog } from "./session-detail-dialog";
import { ClosureDayDTO, ScheduleSessionDTO, SelectOption, WeekSessionDTO } from "./admin-schedule.types";

// The card's left accent is colour-coded by status, using design tokens rather
// than raw colours so it follows the theme: destructive = cancelled, primary =
// scheduled. Completed keeps a distinct muted edge.
function accentColorClass(status: SessionStatus): string {
  if (status === SESSION_STATUS.CANCELLED) return "border-l-destructive";
  if (status === SESSION_STATUS.COMPLETED) return "border-l-muted-foreground";
  return "border-l-primary";
}

type CommonProps = {
  weekStartIso: string;
  // The app's calendar day, resolved server-side. "Today" and "past" are
  // decided from this rather than from the browser clock, so the same day is
  // highlighted on the server render and on the client - and in the app's zone
  // rather than the viewer's.
  todayIso: string;
  closureDays: ClosureDayDTO[];
  // The route the week arrows navigate within. Defaults to the admin schedule;
  // the manager view points the same component at its own path.
  basePath?: string;
};

// The two ways this grid is used. They differ in what a card DOES, so they also
// differ in what each session has to carry: only the editing view needs the
// fields the detail dialog writes to.
type Props = CommonProps &
  (
    | {
        // Admin: every card opens the detail dialog.
        readOnly?: false;
        sessions: ScheduleSessionDTO[];
        leadOptions: SelectOption[];
      }
    | {
        // Manager: the week at a glance. Editing a session and marking
        // attendance stay with the admin schedule, so nothing here is
        // clickable and no editable field is sent to the browser.
        readOnly: true;
        sessions: WeekSessionDTO[];
        leadOptions?: never;
      }
  );

export function WeeklySchedule(props: Props) {
  const { weekStartIso, todayIso, closureDays, basePath = ROUTES.ADMIN_SCHEDULE } = props;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Widened to what the grid draws: an editing week carries more, but nothing
  // below this line may read it.
  const sessions: WeekSessionDTO[] = props.sessions;

  // The dialog needs the editable fields, which only the admin week carries.
  const selectedSession = props.readOnly ? null : (props.sessions.find((s) => s.id === selectedId) ?? null);

  // "now" is captured once after mount (0 during SSR and the first client
  // render), so a session dims only once its end time has genuinely passed on
  // the client - and never differently between server and client render.
  const [nowMs, setNowMs] = useState(0);
  const mounted = nowMs > 0;
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNowMs(Date.now()), []);

  const weekStart = parseISO(weekStartIso);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = days[6];
  const weekLabel = `${format(weekStart, "d MMM")} - ${format(weekEnd, "d MMM yyyy")}`;

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, WeekSessionDTO[]>();
    for (const session of sessions) {
      const list = map.get(session.sessionDate);
      if (list) list.push(session);
      else map.set(session.sessionDate, [session]);
    }
    return map;
  }, [sessions]);

  // Keyed by the 'YYYY-MM-DD' string, so no date arithmetic is involved.
  const closureReasonByDate = useMemo(
    () => new Map(closureDays.map((day) => [day.dateIso, day.reason])),
    [closureDays],
  );

  const goToWeek = (date: Date) => {
    const monday = startOfWeek(date, { weekStartsOn: 1 });
    router.push(`${basePath}?week=${format(monday, "yyyy-MM-dd")}`);
  };

  return (
    <div>
      {/* Week navigation */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="font-heading text-lg font-bold text-foreground">
          {weekLabel}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous week"
            onClick={() => goToWeek(addWeeks(weekStart, -1))}
          >
            <ChevronLeft size={16} />
          </Button>
          {/* The app's own day, not the browser's, so "this week" lands on the
              same week the server would have chosen. */}
          <Button variant="outline" size="sm" onClick={() => goToWeek(parseISO(todayIso))}>
            This week
          </Button>
          <Button variant="outline" size="sm" aria-label="Next week" onClick={() => goToWeek(addWeeks(weekStart, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Week grid - days as lanes; today's lane gets the primary accent. */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => {
          const dayIso = format(day, "yyyy-MM-dd");
          const daySessions = sessionsByDay.get(dayIso) ?? [];
          // Both sides are 'YYYY-MM-DD', so these compare lexicographically.
          const today = dayIso === todayIso;
          const dayIsPast = dayIso < todayIso;
          const closureReason = closureReasonByDate.get(dayIso) ?? null;

          return (
            <li
              key={dayIso}
              aria-current={today ? "date" : undefined}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow",
                today ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border",
              )}
            >
              <div aria-hidden="true" className={cn("h-1.5 w-full", today ? "bg-primary" : "bg-muted")} />

              <h2 className="px-3 pt-3 pb-2 text-center">
                <span className="sr-only">
                  {format(day, "EEEE d MMMM yyyy")}
                  {today ? " (today)" : ""}
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
                    today ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </h2>

              {/* A closure covers the whole day, so it is stated once at the top
                  of the lane - including on a day with nothing scheduled, where
                  it is the reason the lane is empty. */}
              {closureReason && (
                <p className="px-3 pb-2 text-center text-[11px] font-medium text-destructive">
                  Closed, {closureReason}
                </p>
              )}

              {daySessions.length > 0 ? (
                <ul className="flex-1 space-y-2 px-2 pb-3">
                  {daySessions.map((session) => {
                    // A closure day shows the session as cancelled without
                    // changing its stored status.
                    const cancelled = session.status === SESSION_STATUS.CANCELLED || session.closureReason !== null;
                    const effectiveStatus = cancelled ? SESSION_STATUS.CANCELLED : session.status;
                    const away = session.cancelledCount;
                    // Past days are already dimmed at the column level; this
                    // handles today's sessions whose end time has passed.
                    const ended =
                      !dayIsPast &&
                      mounted &&
                      parseISO(`${session.sessionDate}T${session.sessionEnd}`).getTime() < nowMs;
                    const hasRoom =
                      !cancelled && session.capacity > 0 && (session.attendeeCount < session.capacity || away > 0);
                    const availabilityLabel = !hasRoom
                      ? ""
                      : away > 0
                        ? ` - ${away} away, not at capacity`
                        : " - places available";
                    const openLabel = `${session.className} at ${formatTime(session.sessionStart)} on ${format(
                      day,
                      "EEE d MMM",
                    )} - ${SESSION_STATUS_LABELS[effectiveStatus]}${availabilityLabel} - view and edit`;

                    const cardClass = cn(
                      "relative block w-full rounded-lg border border-l-4 bg-card p-2.5 text-left shadow-sm",
                      accentColorClass(effectiveStatus),
                      cancelled && "bg-destructive/5",
                    );

                    // Spans throughout: the editing view wraps this in a
                    // <button>, which may not contain block elements.
                    const cardBody = (
                      <>
                        <span className="flex items-center gap-1 text-xs font-bold text-primary">
                          <Clock size={12} aria-hidden="true" className="shrink-0" />
                          {formatTimeRange(session.sessionStart, session.sessionEnd)}
                          {hasRoom && (
                            <span
                              aria-hidden="true"
                              title={away > 0 ? `${away} away - not at capacity` : "Places available"}
                              className="ml-auto size-2.5 shrink-0 rounded-full bg-signal"
                            />
                          )}
                        </span>
                        <span className="mt-1 block text-sm font-semibold leading-tight text-foreground">
                          {session.className}
                        </span>
                        <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {session.programName}
                        </span>

                        {/* The status in words. The accent colour alone cannot
                            be read, and the read-only view has no dialog to
                            open for it. */}
                        {effectiveStatus !== SESSION_STATUS.SCHEDULED && (
                          <span className="mt-1.5 block text-[11px] font-medium text-muted-foreground">
                            {SESSION_STATUS_LABELS[effectiveStatus]}
                          </span>
                        )}

                        <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin size={13} aria-hidden="true" className="shrink-0" />
                          <span className="truncate">{session.locationName}</span>
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <UserRound size={13} aria-hidden="true" className="shrink-0" />
                          <span className="truncate">{session.leadUserName ?? "No lead"}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <Users size={13} aria-hidden="true" />
                          {session.attendeeCount} / {session.capacity}
                          {/* `signal` is for graphical marks only (the dot
                              above); a teal that has to be READ is `primary`. */}
                          {away > 0 && <span className="font-medium text-primary">· {away} away</span>}
                        </span>

                        {/* Dim a session that has already ended. */}
                        {ended && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 rounded-lg bg-muted-foreground/25"
                          />
                        )}
                      </>
                    );

                    return (
                      <li key={session.id}>
                        {props.readOnly ? (
                          <div className={cardClass}>{cardBody}</div>
                        ) : (
                          <button
                            type="button"
                            aria-label={openLabel}
                            onClick={() => setSelectedId(session.id)}
                            className={cn(
                              cardClass,
                              "transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                            )}
                          >
                            {cardBody}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-1 items-center justify-center px-3 pb-6 pt-2">
                  <p className="text-xs text-muted-foreground">No sessions</p>
                </div>
              )}

              {/* Dim past days. */}
              {dayIsPast && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-muted-foreground/25" />
              )}
            </li>
          );
        })}
      </ul>

      {!props.readOnly && (
        <SessionDetailDialog
          key={selectedSession?.id ?? "none"}
          session={selectedSession}
          leadOptions={props.leadOptions}
          open={selectedSession !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
