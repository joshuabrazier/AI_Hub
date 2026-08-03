import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { getLocationsAction } from "./admin-locations.actions";
import { AdminLocationsTable } from "./table/admin-locations-table";

export default async function AdminLocationsPage() {
  const response = await getLocationsAction();

  return (
    <StandardTablePage response={response}>
      {(locations) => (
        <PortalPage
          eyebrow="Admin"
          title="Locations"
          description="The venues where classes run. Retire one rather than deleting it."
        >
          <AdminLocationsTable locations={locations} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
