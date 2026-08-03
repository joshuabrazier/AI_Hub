import PortalPage from "@/features/layout/portal-page";

import {
  NextSessionsCard,
  QuickLinksCard,
  RecentNotificationsCard,
  YourTeamsCard,
} from "./components/portal-home-cards";
import { getPortalHomeService } from "./portal-home.service";

// -------------------------------------------------------------------
// Member portal home
//
// Everything on this page belongs to the signed-in member, resolved from the
// session inside the service. The route carries no id, so there is nothing
// here that could be pointed at somebody else's data.
// -------------------------------------------------------------------
export default async function PortalHomePage() {
  const home = await getPortalHomeService();

  return (
    <PortalPage
      eyebrow="Your portal"
      title={home.firstName ? `Welcome back, ${home.firstName}` : "Welcome back"}
      description="Your sessions, your teams and anything waiting for you."
    >
      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* The schedule is what a member comes here for, so it leads. */}
        <div className="min-w-0 lg:col-span-2">
          <NextSessionsCard sessions={home.nextSessions} todayIso={home.todayIso} />
        </div>

        <div className="min-w-0 space-y-6">
          <YourTeamsCard teams={home.teams} />
          <RecentNotificationsCard
            notifications={home.notifications}
            unreadCount={home.unreadNotificationCount}
          />
        </div>
      </div>

      <div className="mt-6">
        <QuickLinksCard />
      </div>
    </PortalPage>
  );
}
