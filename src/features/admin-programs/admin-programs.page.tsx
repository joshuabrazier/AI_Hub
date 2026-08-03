import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { getProgramsAction } from "./admin-programs.actions";
import { AdminProgramsTable } from "./table/admin-programs-table";

export default async function AdminProgramsPage() {
  const response = await getProgramsAction();

  return (
    <StandardTablePage response={response}>
      {(programs) => (
        <PortalPage
          eyebrow="Admin"
          title="Programs"
          description="The offerings your classes run under. Retire one rather than deleting it."
        >
          <AdminProgramsTable programs={programs} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
