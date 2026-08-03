import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { getSessionsPageAction } from "./admin-sessions.actions";
import { SessionsTable } from "./table/sessions-table";

export default async function AdminSessionsPage() {
  const response = await getSessionsPageAction();

  return (
    <StandardTablePage response={response}>
      {(data) => (
        <PortalPage
          eyebrow="Admin"
          title="Sessions"
          description="Every dated occurrence of a class. Edit one, or add a one-off to an existing class."
        >
          <SessionsTable sessions={data.sessions} classOptions={data.classOptions} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
