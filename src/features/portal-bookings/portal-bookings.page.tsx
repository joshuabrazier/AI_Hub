import PortalPage from "@/features/layout/portal-page";

import { PortalBookingsList } from "./components/portal-bookings-list";
import { getPortalBookingsService } from "./portal-bookings.service";

// -------------------------------------------------------------------
// Member portal bookings page
//
// The bookings shown are the signed-in member's own, resolved from the session
// inside the service. The route carries no id, so there is no other member's
// bookings this page could be made to render.
// -------------------------------------------------------------------
export default async function PortalBookingsPage() {
  const bookings = await getPortalBookingsService();

  return (
    <PortalPage
      eyebrow="Your portal"
      title="Bookings"
      description="Cannot make a session? Cancel your place so somebody else can take it."
    >
      <PortalBookingsList {...bookings} />
    </PortalPage>
  );
}
