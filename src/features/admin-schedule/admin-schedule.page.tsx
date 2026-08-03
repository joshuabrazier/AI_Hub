import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { todayInAppZone } from "@/lib/timezone";
import { toMondayIso } from "@/lib/week";

import { getScheduleWeekAction } from "./admin-schedule.actions";
import { WeeklySchedule } from "./weekly-schedule";

// -------------------------------------------------------------------
// Admin Schedule Page
//
// `weekParam` is a window, not a permission: which sessions appear inside it is
// resolved from the session inside the service. A ?week= a visitor typed is not
// necessarily a date, so toMondayIso falls back to the app's own calendar day
// rather than turning a mistyped URL into a validation error.
// -------------------------------------------------------------------
export default async function AdminSchedulePage({ weekParam }: { weekParam?: string }) {
  const weekStartIso = toMondayIso(weekParam, todayInAppZone());

  const response = await getScheduleWeekAction({ weekStartIso });

  return (
    <StandardTablePage response={response}>
      {(data) => (
        <PortalPage
          eyebrow="Admin"
          title="Schedule"
          description="The week's sessions. Open one to mark attendance, reassign its lead, or cancel it."
        >
          <WeeklySchedule
            weekStartIso={data.weekStartIso}
            todayIso={data.todayIso}
            sessions={data.sessions}
            closureDays={data.closureDays}
            leadOptions={data.leadOptions}
          />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
