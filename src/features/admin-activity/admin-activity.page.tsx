import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getAuditLogAction } from "./admin-activity.actions";
import { AdminActivityTable } from "./table/admin-activity-table";

export default async function AdminActivityPage() {
  const response = await getAuditLogAction();

  return (
    <StandardTablePage response={response}>
      {(entries) => (
        <PortalPage
          eyebrow="Admin"
          title="Activity"
          description="Who changed what, and when - account and role changes, team membership, and sign-in activity."
        >
          <AdminActivityTable entries={entries} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
