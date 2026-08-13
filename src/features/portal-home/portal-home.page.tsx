import PortalPage from "@/features/layout/portal-page";

import { QuickLinksCard, YourTeamsCard } from "./components/portal-home-cards";
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
      description="Your teams and anything waiting for you."
    >
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <YourTeamsCard teams={home.teams} />
        <QuickLinksCard />
      </div>
    </PortalPage>
  );
}
