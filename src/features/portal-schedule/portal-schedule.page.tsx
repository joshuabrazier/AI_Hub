import PortalPage from "@/features/layout/portal-page";
import { todayInAppZone } from "@/lib/timezone";

import { PortalWeeklyCalendar } from "./components/portal-weekly-calendar";
import { getPortalWeekService } from "./portal-schedule.service";

// -------------------------------------------------------------------
// Member portal schedule page
//
// The sessions shown are the signed-in member's own, resolved from the session
// inside the service. The route carries no id, so there is no other week this
// page could be made to render.
//
// The current week is rendered on the server so the page arrives with content
// rather than a spinner, and the calendar hydrates from the same values.
// -------------------------------------------------------------------
export default async function PortalSchedulePage() {
  const initialWeek = await getPortalWeekService(todayInAppZone());

  return (
    <PortalPage eyebrow="Your portal" title="Schedule" description="The sessions you are booked into, week by week.">
      <PortalWeeklyCalendar initialWeek={initialWeek} />
    </PortalPage>
  );
}
