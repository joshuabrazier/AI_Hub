import PortalPage from "@/features/layout/portal-page";
import { WeeklySchedule } from "@/features/admin-schedule/weekly-schedule";
import { ROUTES } from "@/lib/routes";

import { getManagedScheduleWeekService } from "./manage-schedule.service";

// -------------------------------------------------------------------
// Manager schedule page
//
// The week's sessions for the teams the signed-in manager holds, drawn by the
// SAME grid the admin schedule uses - pointed at this route, and in read-only
// mode. Editing a session and marking attendance stay with the admin schedule.
//
// The seven lanes always render, so a day closed with nothing scheduled still
// says why it is empty.
// -------------------------------------------------------------------
export default async function ManageSchedulePage({ weekParam }: { weekParam?: string }) {
  const week = await getManagedScheduleWeekService(weekParam);

  return (
    <PortalPage
      eyebrow="Manager"
      title="Schedule"
      description={
        week.isUnrestricted
          ? "You are an admin, so every team's sessions are shown here."
          : "The week's sessions for the teams you manage."
      }
    >
      {week.sessions.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          Nothing is scheduled this week. Sessions come from your teams&apos; classes - try another week, or
          check the Classes page.
        </p>
      )}

      <WeeklySchedule
        readOnly
        basePath={ROUTES.MANAGE_SCHEDULE}
        weekStartIso={week.weekStartIso}
        todayIso={week.todayIso}
        sessions={week.sessions}
        closureDays={week.closureDays}
      />
    </PortalPage>
  );
}
