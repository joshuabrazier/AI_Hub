import PortalPage from "@/features/layout/portal-page";
import { StandardTablePage } from "@/features/layout/standard-table-page";

import { getAdminUsersAction, getInvitableTeamsAction } from "./admin-users.actions";
import { AdminUsersTable } from "./table/admin-users-table";

export default async function AdminUsersPage() {
  const [usersResponse, teamsResponse] = await Promise.all([getAdminUsersAction(), getInvitableTeamsAction()]);

  // The team list only feeds the invite dialog's optional picker, so a failure
  // to load it degrades to "invite without a team" rather than blanking the
  // whole screen. The user list is what the page is for, so that one decides
  // whether the page renders at all.
  const invitableTeams = teamsResponse.success ? teamsResponse.data : [];

  return (
    <StandardTablePage response={usersResponse}>
      {(users) => (
        <PortalPage
          eyebrow="Admin"
          title="Users"
          description="Everyone with an account, their role, and the teams they belong to."
        >
          <AdminUsersTable users={users} invitableTeams={invitableTeams} />
        </PortalPage>
      )}
    </StandardTablePage>
  );
}
