"use client";

import Link from "next/link";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_LABELS,
  SESSION_STATUS,
  SESSION_STATUS_LABELS,
} from "@/lib/data/kysely-database-types";
import { formatIsoDate, formatTimeRange } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import type { PortalScheduleSessionDTO } from "../portal-schedule.types";
import { STATUS_PILL_CLASSES } from "./portal-session-styles";

// -------------------------------------------------------------------
// The detail behind a session card: when, where, how full, and where this
// member stands in it.
//
// There is no roster here. A member sees their own place and the size of the
// session, never who else is in it - the count answers "can I still get in"
// without handing out anybody else's name.
// -------------------------------------------------------------------
export function PortalSessionDialog({
  session,
  todayIso,
  open,
  onOpenChange,
}: {
  session: PortalScheduleSessionDTO | null;
  todayIso: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!session) return null;

  const isCancelled = session.status === SESSION_STATUS.CANCELLED;
  const isFull = session.capacity > 0 && session.attendeeCount >= session.capacity;
  const hasCancelledPlace = session.attendanceStatus === ATTENDANCE_STATUS.CANCELLED;

  // Both are 'YYYY-MM-DD' strings from DATE columns, so this compares
  // lexicographically. Neither becomes a Date.
  const isUpcoming = session.sessionDate >= todayIso;

  // Whether the Bookings page is worth offering. The rule that actually
  // decides a cancellation lives in the service; this only avoids pointing
  // somebody at a page that plainly has nothing for them.
  const canManageBooking =
    isUpcoming && !isCancelled && session.attendanceStatus === ATTENDANCE_STATUS.BOOKED;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-8 text-left">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{session.programName}</p>
          <DialogTitle className="font-heading text-2xl font-bold leading-tight">{session.className}</DialogTitle>
          <DialogDescription className="sr-only">Session details for {session.className}</DialogDescription>
        </DialogHeader>

        {isCancelled && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {session.closureReason
              ? `This session is not running: ${session.closureReason}.`
              : "This session has been cancelled."}
          </p>
        )}

        {hasCancelledPlace && !isCancelled && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            You cancelled your place. The session is still running for everyone else.
          </p>
        )}

        <dl className="grid gap-2.5 text-sm">
          <div className="flex items-center gap-2 text-foreground">
            <CalendarDays size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <dt className="sr-only">Date</dt>
            <dd>{formatIsoDate(session.sessionDate, "EEEE d MMMM yyyy")}</dd>
          </div>

          <div className="flex items-center gap-2 text-foreground">
            <Clock size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <dt className="sr-only">Time</dt>
            <dd>{formatTimeRange(session.sessionStart, session.sessionEnd)}</dd>
          </div>

          <div className="flex items-start gap-2 text-foreground">
            <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
            <dt className="sr-only">Location</dt>
            <dd>
              {session.locationName}
              {session.locationAddress && (
                <span className="block text-xs text-muted-foreground">{session.locationAddress}</span>
              )}
            </dd>
          </div>

          <div className="flex items-center gap-2 text-foreground">
            <Users size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <dt className="sr-only">Places taken</dt>
            <dd>
              {session.attendeeCount} of {session.capacity} places taken
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-xs">
          <span className={cn("rounded-full px-2 py-0.5 font-medium", STATUS_PILL_CLASSES[session.status])}>
            {SESSION_STATUS_LABELS[session.status]}
          </span>

          <Badge variant={hasCancelledPlace ? "secondary" : "outline"}>
            Your place: {ATTENDANCE_STATUS_LABELS[session.attendanceStatus]}
          </Badge>

          {!isCancelled && isFull && <Badge variant="warning">Full</Badge>}
        </div>

        <DialogFooter>
          {canManageBooking && (
            <Button variant="outline" asChild>
              <Link href={ROUTES.PORTAL_BOOKINGS}>Manage booking</Link>
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
