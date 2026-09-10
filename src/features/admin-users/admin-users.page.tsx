import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getAdminUsersAction } from "./admin-users.actions";
import { AdminUsersTable } from "./table/admin-users-table";

export default async function AdminUsersPage() {
  const usersResponse = await getAdminUsersAction();


  return (
    <StandardTablePage response={usersResponse}>
      {(users) => (
        <PortalPage
          eyebrow="Admin"
          title="Users"
          description="Everyone with an account, and their role."
        >
          <AdminUsersTable users={users} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
