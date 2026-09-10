import { FolderKanban, ShieldCheck, Users } from "lucide-react";

import {
  DeliveryStatTiles,
  WaitingOnYouCard,
  YourWeekCard,
  type DeliveryHomeRoutes,
} from "@/features/delivery/components/delivery-home-cards";
import { getMyDeliverySummaryService } from "@/features/delivery/delivery-home.service";
import { SignInSuccessToast } from "@/features/home/sign-in-success-toast";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";

import { getAdminDashboardService } from "./admin-dashboard.service";
import { StatTile } from "./dashboard-cards";

// -------------------------------------------------------------------
// Admin dashboard
//
// The admin landing page: what the platform looks like, then what is waiting
// on the person reading it.
//
// The page takes no arguments and passes none. Who is asking is resolved from
// the session inside the service, which is also where the admin guard lives -
// the area layout checks the same thing, but neither is load-bearing alone.
//
// TWO KINDS OF FIGURE, AND THEY ARE NOT THE SAME KIND. The tiles at the top
// are the ORGANISATION - counts of accounts and invitations, which is what an
// administrator is here for. Everything below is the reader's OWN work, and
// it is scoped by membership rather than by role: an admin is a member of
// projects like anybody else, and being an admin does not put a task on their
// board. The same cards render on the member portal from the same service,
// so the two areas cannot come to disagree about somebody's own week.
// -------------------------------------------------------------------
const ADMIN_ROUTES: DeliveryHomeRoutes = {
  projects: ROUTES.ADMIN_PROJECTS,
  timesheet: ROUTES.ADMIN_TIMESHEET,
  board: (projectId) => ROUTES.adminProject(projectId),
};

export default async function AdminDashboardPage() {
  const [dashboard, summary] = await Promise.all([
    getAdminDashboardService(),
    getMyDeliverySummaryService(),
  ]);

  return (
    <PortalPage
      eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]}
      title={dashboard.firstName ? `Welcome back, ${dashboard.firstName}` : "Welcome back"}
      description="Here's your overview of the platform."
    >
      <SignInSuccessToast />

      {/* Headline counts about the ORGANISATION. Each one links to the page
          that owns it. Three, sized to what is here rather than left at
          four, which put a quarter-width hole on the right. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
        {/* Was "Pending invites", which reported on a door nobody comes
            through: sign-in is Microsoft only and the app auto-provisions, so
            an invitation is a role pre-assignment rather than a gate and this
            deployment does not use them. A headline figure that is
            structurally zero teaches people to stop reading the row. */}
        <StatTile
          icon={FolderKanban}
          value={dashboard.stats.activeProjects}
          label="Active projects"
          href={ROUTES.ADMIN_PROJECTS}
        />
      </div>

      {/* The reader's own work, below the platform's figures. */}
      <div className="mt-6">
        <DeliveryStatTiles summary={summary} routes={ADMIN_ROUTES} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <WaitingOnYouCard summary={summary} routes={ADMIN_ROUTES} />

        {/* `today` comes from the APP's timezone, so the highlighted column
            is the organisation's day rather than the reader's. */}
        <YourWeekCard summary={summary} today={todayInAppZone()} routes={ADMIN_ROUTES} />
      </div>
    </PortalPage>
  );
}
