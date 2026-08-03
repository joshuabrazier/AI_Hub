import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";
import { getClassesPageAction } from "./admin-classes.actions";
import { AdminClassesTable } from "./table/admin-classes-table";

export default async function AdminClassesPage() {
  const response = await getClassesPageAction();

  return (
    <StandardTablePage response={response}>
      {(data) => (
        <PortalPage
          eyebrow="Admin"
          title="Classes"
          description="A class runs weekly between its start and end dates. Its sessions are generated across that range."
        >
          <AdminClassesTable
            classes={data.classes}
            programOptions={data.programOptions}
            locationOptions={data.locationOptions}
            teamOptions={data.teamOptions}
            leadOptions={data.leadOptions}
            canCreateWithoutTeam={data.canCreateWithoutTeam}
          />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
