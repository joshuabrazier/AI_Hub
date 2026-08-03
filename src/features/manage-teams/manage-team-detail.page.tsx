import Link from "next/link";
import { ArrowLeft, UsersRound } from "lucide-react";

import PortalPage from "@/features/layout/portal-page";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TEAM_ROLE_LABELS, TEAM_ROLES } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";

import { getManagedTeamDetailService } from "./manage-teams.service";

// -------------------------------------------------------------------
// One team a manager holds, with its membership.
//
// The team id arrives from the URL and is treated as a routing detail only:
// the service passes it to requireTeamManagement, which answers NOT FOUND
// unless the signed-in manager actually holds that team - deliberately the
// same answer a made-up id gets, so a guess cannot confirm a team exists.
// Nothing on this page is rendered before that check has passed.
//
// Read-only by design. Adding or removing somebody is an authorization
// change, so it stays with the admin.
// -------------------------------------------------------------------
export default async function ManageTeamDetailPage({ teamId }: { teamId: string }) {
  const { team, members } = await getManagedTeamDetailService(teamId);

  return (
    <PortalPage
      eyebrow="Manager"
      title={team.name}
      description={team.description || "No description"}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href={ROUTES.MANAGE_TEAMS}>
            <ArrowLeft size={16} aria-hidden="true" />
            All teams
          </Link>
        </Button>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge active={team.isActive} />
        <span className="text-sm text-muted-foreground">
          {team.memberCount} {team.memberCount === 1 ? "member" : "members"} - {team.managerCount}{" "}
          {team.managerCount === 1 ? "manager" : "managers"}
        </span>
      </div>

      <Card>
        <CardContent>
          <div className="mb-4 flex items-center gap-2">
            <UsersRound size={18} aria-hidden="true" className="text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">Members</h2>
          </div>

          {members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nobody is in this team yet. An admin adds people to it.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {members.map((member) => (
                <li key={member.membershipId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                      {member.displayName}
                      {!member.isActive && <Badge variant="destructive">Inactive</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>

                  <Badge variant={member.teamRole === TEAM_ROLES.MANAGER ? "default" : "secondary"}>
                    {TEAM_ROLE_LABELS[member.teamRole]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PortalPage>
  );
}
