"use client";

import { AppDialog } from "@/components/app-dialog";
import { SessionRoster } from "@/features/admin-schedule/session-roster";
import { formatIsoDate, formatTime } from "@/lib/format";

import { SessionResponseDTO } from "../admin-sessions.types";

type Props = {
  session: SessionResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Roster dialog for the Sessions tab - reuses the shared SessionRoster, which
// fetches and authorizes its own data through the session's owning class.
// -------------------------------------------------------------------
export function SessionRosterDialog({ session, open, onOpenChange }: Props) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Roster"
      description={
        session
          ? `${session.className} - ${formatIsoDate(session.sessionDate, "EEE d MMM yyyy")}, ${formatTime(session.sessionStart)}`
          : undefined
      }
    >
      {session && <SessionRoster sessionId={session.id} />}
    </AppDialog>
  );
}
