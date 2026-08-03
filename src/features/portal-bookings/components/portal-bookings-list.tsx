"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { CalendarClock, CalendarOff, Clock, type LucideIcon, MapPin } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_LABELS,
  SESSION_STATUS,
  SESSION_STATUS_LABELS,
} from "@/lib/data/kysely-database-types";
import { formatIsoDate, formatTimeRange } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { cancelBookingAction } from "../portal-bookings.actions";
import type { PortalBookingDTO, PortalBookingsResponseDTO } from "../portal-bookings.types";

// Label a date relative to today when that reads better than the date itself.
// Both values are 'YYYY-MM-DD', so these are string comparisons.
function describeDate(sessionDate: string, todayIso: string): string {
  if (sessionDate === todayIso) return "Today";
  if (sessionDate === format(addDays(parseISO(todayIso), 1), "yyyy-MM-dd")) return "Tomorrow";

  return formatIsoDate(sessionDate, "EEE d MMM");
}

// Why a place cannot be given up, in one word. The session being off comes
// first: that is the reason that overrides the member's own status, and saying
// "Scheduled" against a session nobody can attend would be worse than useless.
function describeUncancellable(booking: PortalBookingDTO): string {
  if (booking.status === SESSION_STATUS.CANCELLED) return SESSION_STATUS_LABELS[SESSION_STATUS.CANCELLED];
  if (booking.attendanceStatus !== ATTENDANCE_STATUS.BOOKED) {
    return ATTENDANCE_STATUS_LABELS[booking.attendanceStatus];
  }

  return SESSION_STATUS_LABELS[booking.status];
}

// -------------------------------------------------------------------
// The member's bookings, and the control that gives one up.
//
// Cancelling releases the place and leaves the row on the record. There is
// nothing else to choose here: no credit to spend, no window to beat, and no
// other session to move into. If a member needs a different session, that is a
// conversation with staff rather than a self-service swap.
// -------------------------------------------------------------------
export function PortalBookingsList({ bookings, cancelled, todayIso, horizonIso }: PortalBookingsResponseDTO) {
  const router = useRouter();
  const [pending, setPending] = useState<PortalBookingDTO | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const onConfirm = async () => {
    if (!pending || isCancelling) return;
    setIsCancelling(true);

    try {
      const response = await cancelBookingAction({ attendeeId: pending.attendeeId });

      if (!response.success) {
        toast.error(response.formError ?? "We could not cancel that booking.");
        return;
      }

      toast.success("Booking cancelled");
      setPending(null);
      router.refresh();
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="font-heading text-xl">Your bookings</CardTitle>
          <CardDescription>
            Sessions you hold a place in, up to {formatIsoDate(horizonIso)}. Cancelling frees your place for
            somebody else.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {bookings.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No bookings coming up"
              subtitle="Places you hold in upcoming sessions appear here"
            />
          ) : (
            <ul className="divide-y divide-border">
              {bookings.map((booking) => (
                <li key={booking.attendeeId} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
                  <BookingSummary booking={booking} todayIso={todayIso} />

                  <div className="ml-auto shrink-0">
                    {booking.canCancel ? (
                      <Button variant="outline" size="sm" onClick={() => setPending(booking)}>
                        Cancel place
                      </Button>
                    ) : (
                      <Badge variant="secondary">{describeUncancellable(booking)}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Kept visible rather than hidden once cancelled: the record is what
          staff see too, and a member should be able to check it went through. */}
      {cancelled.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="font-heading text-xl">Cancelled</CardTitle>
            <CardDescription>Places you have given up. Contact us if you need one back.</CardDescription>
          </CardHeader>

          <CardContent>
            <ul className="divide-y divide-border">
              {cancelled.map((booking) => (
                <li key={booking.attendeeId} className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
                  <BookingSummary booking={booking} todayIso={todayIso} isMuted />

                  <div className="ml-auto shrink-0">
                    <Badge variant="secondary">Cancelled</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isCancelling) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="font-heading text-xl">Cancel this place?</DialogTitle>
            <DialogDescription>
              {pending
                ? `${pending.className} on ${formatIsoDate(pending.sessionDate, "EEEE d MMMM")}, ${formatTimeRange(
                    pending.sessionStart,
                    pending.sessionEnd,
                  )}.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Your place is released for somebody else and the session stays on your record as cancelled. You cannot
            book yourself back in.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={isCancelling}>
              Keep my place
            </Button>
            <Button variant="destructive" onClick={onConfirm} loading={isCancelling}>
              {isCancelling ? "Cancelling" : "Cancel place"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -------------------------------------------------------------------
// The identifying detail of one booking: when, what and where.
// -------------------------------------------------------------------
function BookingSummary({
  booking,
  todayIso,
  isMuted = false,
}: {
  booking: PortalBookingDTO;
  todayIso: string;
  isMuted?: boolean;
}) {
  const isSessionCancelled = booking.status === SESSION_STATUS.CANCELLED;

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          isMuted || isSessionCancelled ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        {isSessionCancelled ? <CalendarOff size={18} /> : <CalendarClock size={18} />}
      </span>

      <div className="min-w-0">
        <p
          className={cn(
            "truncate font-medium text-foreground",
            (isMuted || isSessionCancelled) && "text-muted-foreground line-through",
          )}
        >
          {booking.className}
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{describeDate(booking.sessionDate, todayIso)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} aria-hidden="true" className="shrink-0" />
            {formatTimeRange(booking.sessionStart, booking.sessionEnd)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{booking.locationName}</span>
          </span>
        </p>

        {booking.closureReason && (
          <p className="mt-0.5 text-xs font-medium text-destructive">{booking.closureReason}</p>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon size={22} aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
