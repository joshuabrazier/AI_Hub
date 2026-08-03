import { CalendarClock, GraduationCap, LayoutPanelLeft, Users } from "lucide-react";

import { SignInSuccessToast } from "@/features/home/sign-in-success-toast";
import PortalPage from "@/features/layout/portal-page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { getAdminDashboardService } from "./admin-dashboard.service";
import { RecentBroadcastsCard, StatTile, TeamsCard, TodayScheduleCard } from "./dashboard-cards";

// -------------------------------------------------------------------
// Admin dashboard
//
// The admin landing page: headline counts, what is on today, and a side column
// of teams and recent messages.
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
      description="Here's your overview of today."
    >
      <SignInSuccessToast />

      {/* Headline counts. Each one links to the page that owns it. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={CalendarClock}
          value={dashboard.stats.sessionsToday}
          label="Sessions today"
          href={ROUTES.ADMIN_SCHEDULE}
        />
        <StatTile
          icon={GraduationCap}
          value={dashboard.stats.activeClasses}
          label="Active classes"
          href={ROUTES.ADMIN_CLASSES}
        />
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
      </div>

      {/* Today's schedule is what staff come here for, so it leads. */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <TodayScheduleCard
            sessions={dashboard.todaySessions}
            todayIso={dashboard.todayIso}
            weekSessionCount={dashboard.weekSessionCount}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <TeamsCard teams={dashboard.teams} totalTeams={dashboard.stats.activeTeams} />
          <RecentBroadcastsCard broadcasts={dashboard.broadcasts} />
        </div>
      </div>
    </PortalPage>
  );
}
