import PortalPage from "@/features/layout/portal-page";
import { getMyDeliverySummaryService } from "@/features/delivery/delivery-home.service";
import {
  DeliveryStatTiles,
  WaitingOnYouCard,
  YourWeekCard,
  type DeliveryHomeRoutes,
} from "@/features/delivery/components/delivery-home-cards";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";

import { QuickLinksCard } from "./components/portal-home-cards";
import { getPortalHomeService } from "./portal-home.service";

// -------------------------------------------------------------------
// Member portal home
//
// Everything on this page belongs to the signed-in member, resolved from the
// session inside each service. The route carries no id, so there is nothing
// here that could be pointed at somebody else's data.
//
// IT USED TO BE A GREETING AND TWO LINKS, which made the first screen of the
// app the one screen with nothing on it. What is here now is what somebody
// opening the portal in the morning actually wants: how much they have
// logged this week, what is assigned to them with the blocked ones first,
// and the shape of the week so a day they forgot to fill in is visible
// without opening the timesheet.
//
// THE ROUTES ARE PASSED DOWN, never built in the cards. The same cards
// render on the admin dashboard, and the proxy REDIRECTS a role that lands
// in the wrong area rather than refusing it - so a hardcoded /portal/ href
// followed by an admin is not an error anybody sees, it is a link that
// quietly goes somewhere else.
//
// TWO SERVICE CALLS, IN PARALLEL. The greeting needs the member guard;
// the summary is membership-scoped and guards with requireUser inside each
// of the three reads it composes.
// -------------------------------------------------------------------
const PORTAL_ROUTES: DeliveryHomeRoutes = {
  projects: ROUTES.PORTAL_PROJECTS,
  timesheet: ROUTES.PORTAL_TIMESHEET,
  board: (projectId) => ROUTES.portalProject(projectId),
};

export default async function PortalHomePage() {
  const [home, summary] = await Promise.all([getPortalHomeService(), getMyDeliverySummaryService()]);

  return (
    <PortalPage
      eyebrow="Your portal"
      title={home.firstName ? `Welcome back, ${home.firstName}` : "Welcome back"}
      description="Your week, and what is waiting for you."
    >
      <DeliveryStatTiles summary={summary} routes={PORTAL_ROUTES} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <WaitingOnYouCard summary={summary} routes={PORTAL_ROUTES} />

        {/* `today` comes from the APP's timezone, so the highlighted column
            is the organisation's day rather than the reader's. Nothing on
            this page constructs a Date. */}
        <YourWeekCard summary={summary} today={todayInAppZone()} routes={PORTAL_ROUTES} />
      </div>

      <div className="mt-6">
        <QuickLinksCard />
      </div>
    </PortalPage>
  );
}
