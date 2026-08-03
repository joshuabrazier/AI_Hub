import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getTeamsAction } from "./admin-teams.actions";
import { AdminTeamsTable } from "./table/admin-teams-table";

export default async function AdminTeamsPage() {
  const response = await getTeamsAction();

  return (
    <StandardTablePage response={response}>
      {(teams) => (
        <PortalPage
          eyebrow="Admin"
          title="Teams"
          description="Create teams and choose who belongs to them. A team's membership decides what its managers and members can reach."
        >
          <AdminTeamsTable teams={teams} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
