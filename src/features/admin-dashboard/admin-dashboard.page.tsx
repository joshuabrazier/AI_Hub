import { LayoutPanelLeft, MailPlus, ShieldCheck, Users } from "lucide-react";

import { SignInSuccessToast } from "@/features/home/sign-in-success-toast";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { getAdminDashboardService } from "./admin-dashboard.service";
import { StatTile, TeamsCard } from "./dashboard-cards";

// -------------------------------------------------------------------
// Admin dashboard
//
// The admin landing page: headline counts, then the teams and the messages
// recently sent.
//
// The page takes no arguments and passes none. Who is asking is resolved from
// the session inside the service, which is also where the admin guard lives -
// the area layout checks the same thing, but neither is load-bearing alone.
// -------------------------------------------------------------------
export default async function AdminDashboardPage() {
  const dashboard = await getAdminDashboardService();

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title={dashboard.firstName ? `Welcome back, ${dashboard.firstName}` : "Welcome back"}
      description="Here's your overview of the platform."
    >
      <SignInSuccessToast />

      {/* Headline counts. Each one links to the page that owns it. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={LayoutPanelLeft}
          value={dashboard.stats.activeTeams}
          label="Teams"
          href={ROUTES.ADMIN_TEAMS}
        />
        <StatTile
          icon={Users}
          value={dashboard.stats.activeMembers}
          label="Active members"
          href={ROUTES.ADMIN_USERS}
        />
        <StatTile
          icon={ShieldCheck}
          value={dashboard.stats.activeStaff}
          label="Staff accounts"
          href={ROUTES.ADMIN_USERS}
        />
        <StatTile
          icon={MailPlus}
          value={dashboard.stats.pendingInvitations}
          label="Pending invites"
          href={ROUTES.ADMIN_USERS}
        />
      </div>

      <div className="mt-6 grid items-start gap-6">
        <TeamsCard teams={dashboard.teams} totalTeams={dashboard.stats.activeTeams} />
      </div>
    </PortalPage>
  );
}
