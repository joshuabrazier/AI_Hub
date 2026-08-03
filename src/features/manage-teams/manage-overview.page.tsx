import Link from "next/link";
import { ArrowRight, LayoutPanelLeft, type LucideIcon, UsersRound } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { ManagedTeamCard } from "./components/managed-team-card";
import { getManageOverviewService } from "./manage-teams.service";

// How many teams the overview shows before pointing at the full list.
const MAX_TEAMS_SHOWN = 6;

function StatTile({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Icon size={24} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-4xl font-bold leading-none tracking-tight text-foreground">{value}</p>
          <p className="mt-1.5 text-sm font-medium text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------------------------------------------------------
// Manager home
//
// The teams an admin assigned this manager, and nothing else. The scope is
// resolved from the session inside the service; this page never asks for a
// team by id.
// -------------------------------------------------------------------
export default async function ManageOverviewPage() {
  const user = await requireUserRole([USER_ROLES.ADMIN, USER_ROLES.MANAGER]);
  const firstName = user.name?.trim().split(" ")[0];

  const overview = await getManageOverviewService();
  const shown = overview.teams.slice(0, MAX_TEAMS_SHOWN);
  const extra = overview.teams.length - shown.length;

  return (
    <PortalPage
      eyebrow="Manager"
      title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      description={
        overview.isUnrestricted
          ? "You are an admin, so every team is shown here."
          : "The teams you have been assigned to manage."
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile icon={LayoutPanelLeft} value={overview.teams.length} label="Teams you manage" />
        <StatTile icon={UsersRound} value={overview.totalMembers} label="People across them" />
      </div>

      {overview.teams.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-10 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LayoutPanelLeft size={22} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">No teams yet</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              An admin assigns you to a team. Once they do, it appears here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="font-heading text-xl font-semibold text-foreground">Your teams</h2>
            <Button variant="outline" size="sm" asChild>
              <Link href={ROUTES.MANAGE_TEAMS}>
                View all
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((team) => (
              <ManagedTeamCard key={team.id} team={team} />
            ))}
          </div>

          {extra > 0 && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {extra} more {extra === 1 ? "team" : "teams"} on the Teams page
            </p>
          )}
        </section>
      )}
    </PortalPage>
  );
}
