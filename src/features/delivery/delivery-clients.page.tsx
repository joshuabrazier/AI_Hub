import PortalPage from "@/features/layout/portal-page";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";

import { SetupClientsTable } from "./components/setup-clients-table";
import { getClientsService } from "./delivery-setup.service";

// -------------------------------------------------------------------
// CLIENTS
//
// Who the work is for, with the number of projects hanging off each one.
//
// ADMIN ONLY, and unlike projects it has no /manage or /portal counterpart:
// a client is the commercial relationship, not a thing a project member
// needs. The guard is repeated here rather than left to the area layout on
// the same reasoning the layout itself gives - the layout is one matcher
// change away from being the only gate - and getClientsService checks again.
//
// THERE IS NO DELETE, AND THE SCREEN SAYS SO RATHER THAN OFFERING ONE.
// `projects.client_id` is ON DELETE RESTRICT precisely so that removing a
// client cannot take its projects' time entries - billing history - with
// it. That is why `projectCount` travels on the DTO: a button that always
// fails for the clients somebody actually cares about is worse than a
// sentence explaining what retiring does instead.
//
// Retired clients stay on the list, because the projects behind them do.
// -------------------------------------------------------------------
export default async function DeliveryClientsPage() {
  await requireUserRole([USER_ROLES.ADMIN]);

  // Retired ones included - see the service. The table's own "Active only"
  // toggle decides what is shown, so retiring somebody does not make them
  // unreachable.
  const clients = await getClientsService();

  return (
    <PortalPage
      title="Clients"
      description="Who the work is for. Retired clients stay on the list, because the projects behind them do."
    >
      <SetupClientsTable clients={clients} />
    </PortalPage>
  );
}
