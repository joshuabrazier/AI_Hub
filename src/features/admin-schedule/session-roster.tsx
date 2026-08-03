"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ATTENDANCE_STATUS, ATTENDANCE_STATUS_LABELS } from "@/lib/data/kysely-database-types";

import { getSessionRosterAction, setAttendanceStatusAction } from "./admin-schedule.actions";
import {
  MARKABLE_ATTENDANCE_STATUSES,
  MarkableAttendanceStatus,
  RosterEntryDTO,
} from "./admin-schedule.types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// -------------------------------------------------------------------
// One person on the roster.
//
// A place the member cancelled is shown but not markable: they gave the place
// up, which freed it, and taking that decision back is theirs to make. Everyone
// else can be marked booked / attended / absent.
// -------------------------------------------------------------------
function RosterRow({
  entry,
  onMark,
  disabled,
}: {
  entry: RosterEntryDTO;
  onMark: (entry: RosterEntryDTO, status: MarkableAttendanceStatus) => void;
  disabled: boolean;
}) {
  const cancelled = entry.status === ATTENDANCE_STATUS.CANCELLED;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials(entry.userName)}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{entry.userName}</span>

      {cancelled ? (
        <Badge variant="destructive">{ATTENDANCE_STATUS_LABELS[ATTENDANCE_STATUS.CANCELLED]}</Badge>
      ) : (
        <span className="flex shrink-0 gap-1" role="group" aria-label={`Attendance for ${entry.userName}`}>
          {MARKABLE_ATTENDANCE_STATUSES.map((status) => {
            const active = entry.status === status;
            return (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onMark(entry, status)}
                className={cn("h-7 px-2 text-xs", active && "pointer-events-none")}
              >
                {ATTENDANCE_STATUS_LABELS[status]}
              </Button>
            );
          })}
        </span>
      )}
    </li>
  );
}

// -------------------------------------------------------------------
// SessionRoster
//
// The people on one session, with their attendance. Fetches its own data so it
// can be dropped into any dialog or card - and so the server, not the caller,
// decides whether this roster may be read at all.
// -------------------------------------------------------------------
export function SessionRoster({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterEntryDTO[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the roster when the session changes
    setLoading(true);
    (async () => {
      const response = await getSessionRosterAction({ sessionId });
      if (!active) return;
      if (response.success) setRoster(response.data);
      else toast.error(response.formError ?? "Could not load the roster");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [sessionId]);

  const handleMark = (entry: RosterEntryDTO, status: MarkableAttendanceStatus) => {
    if (entry.status === status) return;

    startTransition(async () => {
      const response = await setAttendanceStatusAction({ attendeeId: entry.attendeeId, status });

      if (!response.success) {
        toast.error(response.formError ?? "Could not save that");
        return;
      }

      // Reflect the saved value locally rather than refetching the whole list -
      // marking a roster is a rapid, repeated action.
      setRoster((previous) =>
        previous.map((row) => (row.attendeeId === entry.attendeeId ? { ...row, status } : row)),
      );
    });
  };

  const placesTaken = roster.filter((entry) => entry.status !== ATTENDANCE_STATUS.CANCELLED).length;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Roster</p>
        {!loading && roster.length > 0 && (
          <span className="text-xs text-muted-foreground">{placesTaken} taking a place</span>
        )}
      </div>

      {loading ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex items-center gap-3 px-3 py-3">
              <span className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
              <span className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : roster.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Nobody is in this class yet.
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-x-hidden overflow-y-auto rounded-xl border">
          {roster.map((entry) => (
            <RosterRow key={entry.attendeeId} entry={entry} onMark={handleMark} disabled={isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}
