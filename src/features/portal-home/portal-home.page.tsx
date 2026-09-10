import PortalPage from "@/features/layout/portal-page";

import { QuickLinksCard } from "./components/portal-home-cards";
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
      description="Where to go next."
    >
      {/* One card since YourTeamsCard went, so no two-column grid to sit in. */}
      <QuickLinksCard />
    </PortalPage>
  );
}
